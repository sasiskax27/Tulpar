//! VM Studio: виртуальные машины через QEMU. Tulpar — только удобная оболочка:
//! диски создаёт qemu-img, машины запускает qemu-system-*. Запускать можно
//! только эти программы; машины останавливаются вместе с Tulpar.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

#[derive(Default)]
pub struct VmState {
    running: Mutex<HashMap<String, Child>>,
}

impl VmState {
    /// Остановить все машины при выходе из Tulpar.
    pub fn kill_all(&self) {
        if let Ok(mut map) = self.running.lock() {
            for (_, child) in map.iter_mut() {
                let _ = child.kill();
            }
            map.clear();
        }
    }
}

const ALLOWED: &[&str] = &["qemu-img", "qemu-system-x86_64", "qemu-system-aarch64"];

fn exe_name(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() }
}

/// Где искать QEMU: PATH, стандартная папка Windows, Homebrew.
fn find(name: &str) -> Option<PathBuf> {
    let file = exe_name(name);
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if cfg!(windows) {
        dirs.push(PathBuf::from(r"C:\Program Files\qemu"));
    } else {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
    }
    dirs.into_iter().map(|d| d.join(&file)).find(|p| p.is_file())
}

fn command(name: &str) -> Result<Command, String> {
    if !ALLOWED.contains(&name) {
        return Err("эта программа не разрешена".into());
    }
    let path = find(name).ok_or_else(|| format!("{name} не найден — установите QEMU"))?;
    let mut c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    Ok(c)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VmInfo {
    qemu: bool,
    version: String,
    dir: String,
    /// Ускорение, доступное на этой машине: kvm | whpx | hvf | tcg
    accel: String,
}

/// Есть ли QEMU, где хранятся диски и какое ускорение доступно.
#[tauri::command]
pub async fn vm_info() -> Result<VmInfo, String> {
    let dir = crate::config::dir().ok_or("нет папки настроек")?.join("vms");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let version = command("qemu-img")
        .ok()
        .and_then(|mut c| c.arg("--version").output().ok())
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().next().unwrap_or("").to_owned())
        .unwrap_or_default();
    let accel = if cfg!(target_os = "linux") {
        if std::path::Path::new("/dev/kvm").exists() { "kvm" } else { "tcg" }
    } else if cfg!(windows) {
        "whpx"
    } else {
        "hvf"
    };
    Ok(VmInfo { qemu: !version.is_empty(), version, dir: dir.to_string_lossy().into_owned(), accel: accel.into() })
}

/// qemu-img: создать диск, снимки, сведения. Ждёт завершения.
#[tauri::command]
pub async fn vm_img(args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = command("qemu-img")?.args(&args).output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        if out.status.success() { Ok(text) } else { Err(String::from_utf8_lossy(&out.stderr).trim().to_owned()) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Запустить машину. name — ключ, чтобы потом остановить.
#[tauri::command]
pub fn vm_start(state: State<'_, VmState>, name: String, system: String, args: Vec<String>) -> Result<u32, String> {
    if !system.starts_with("qemu-system-") {
        return Err("неверная программа".into());
    }
    let mut map = state.running.lock().map_err(|_| "состояние повреждено")?;
    if let Some(child) = map.get_mut(&name) {
        if matches!(child.try_wait(), Ok(None)) {
            return Err("машина уже запущена".into());
        }
    }
    let child = command(&system)?
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    map.insert(name, child);
    Ok(pid)
}

/// Какие машины сейчас работают; для упавших — текст ошибки QEMU.
#[tauri::command]
pub fn vm_status(state: State<'_, VmState>) -> Result<HashMap<String, String>, String> {
    let mut map = state.running.lock().map_err(|_| "состояние повреждено")?;
    let mut out = HashMap::new();
    let mut done = Vec::new();
    for (name, child) in map.iter_mut() {
        match child.try_wait() {
            Ok(None) => {
                out.insert(name.clone(), "running".into());
            }
            Ok(Some(status)) => {
                let mut err = String::new();
                if let Some(mut e) = child.stderr.take() {
                    use std::io::Read;
                    let _ = e.read_to_string(&mut err);
                }
                out.insert(name.clone(), if status.success() { "stopped".into() } else { format!("error:{}", err.trim()) });
                done.push(name.clone());
            }
            Err(e) => {
                out.insert(name.clone(), format!("error:{e}"));
                done.push(name.clone());
            }
        }
    }
    for n in done {
        map.remove(&n);
    }
    Ok(out)
}

#[tauri::command]
pub fn vm_stop(state: State<'_, VmState>, name: String) -> Result<(), String> {
    let mut map = state.running.lock().map_err(|_| "состояние повреждено")?;
    if let Some(mut child) = map.remove(&name) {
        child.kill().map_err(|e| e.to_string())?;
        let _ = child.wait();
    }
    Ok(())
}
