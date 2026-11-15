//! Локальные серверы из магазина Tulpar (nginx, PostgreSQL, MySQL, Redis,
//! Caddy…): запуск, остановка, журнал. Программы лежат в папке runtimes;
//! запускать разрешено только файлы оттуда.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::State;

const LOG_LINES: usize = 400;

struct Running {
    child: Child,
    log: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Default)]
pub struct ServicesState(Mutex<HashMap<String, Running>>);

impl ServicesState {
    pub fn kill_all(&self) {
        if let Ok(mut map) = self.0.lock() {
            for (_, mut r) in map.drain() {
                let _ = r.child.kill();
            }
        }
    }
}

fn runtimes_root() -> Result<PathBuf, String> {
    Ok(crate::config::dir().ok_or("нет папки настроек")?.join("runtimes"))
}

/// Путь внутри runtimes/<kind>; ничего за его пределами.
fn inside(kind: &str, rel: &str) -> Result<PathBuf, String> {
    if kind.is_empty() || !kind.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("неизвестный сервер".into());
    }
    let base = runtimes_root()?.join(kind);
    let mut p = base.clone();
    for c in std::path::Path::new(rel).components() {
        match c {
            std::path::Component::Normal(x) => p.push(x),
            std::path::Component::CurDir => {}
            _ => return Err("недопустимый путь".into()),
        }
    }
    Ok(p)
}

fn pipe_lines<R: std::io::Read + Send + 'static>(r: R, log: Arc<Mutex<VecDeque<String>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(r).lines().map_while(Result::ok) {
            if let Ok(mut l) = log.lock() {
                l.push_back(line);
                while l.len() > LOG_LINES {
                    l.pop_front();
                }
            }
        }
    });
}

fn command(kind: &str, exe: &str, args: &[String], cwd: Option<&str>) -> Result<Command, String> {
    let exe_path = inside(kind, exe)?;
    if !exe_path.is_file() {
        return Err(format!("не найден {} — переустановите из магазина", exe_path.display()));
    }
    let mut cmd = Command::new(&exe_path);
    cmd.args(args);
    let dir = match cwd {
        Some(c) if !c.is_empty() => inside(kind, c)?,
        _ => inside(kind, "")?,
    };
    cmd.current_dir(dir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    Ok(cmd)
}

/// Однократная команда (например, initdb) — дождаться и вернуть вывод.
#[tauri::command]
pub async fn service_run_once(kind: String, exe: String, args: Vec<String>, cwd: Option<String>) -> Result<(i32, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = command(&kind, &exe, &args, cwd.as_deref())?.output().map_err(|e| e.to_string())?;
        Ok((out.status.code().unwrap_or(-1), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr))))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn service_start(state: State<'_, ServicesState>, id: String, kind: String, exe: String, args: Vec<String>, cwd: Option<String>) -> Result<u32, String> {
    let mut map = state.0.lock().map_err(|_| "состояние повреждено")?;
    if let Some(r) = map.get_mut(&id) {
        if r.child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
            return Err("уже запущен".into());
        }
    }
    let mut child = command(&kind, &exe, &args, cwd.as_deref())?.spawn().map_err(|e| e.to_string())?;
    let log = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(o) = child.stdout.take() {
        pipe_lines(o, log.clone());
    }
    if let Some(e) = child.stderr.take() {
        pipe_lines(e, log.clone());
    }
    let pid = child.id();
    map.insert(id, Running { child, log });
    Ok(pid)
}

#[tauri::command]
pub fn service_stop(state: State<'_, ServicesState>, id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "состояние повреждено")?;
    if let Some(mut r) = map.remove(&id) {
        let _ = r.child.kill();
        let _ = r.child.wait();
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ServiceStatus {
    id: String,
    running: bool,
    pid: u32,
    exit: Option<i32>,
}

#[tauri::command]
pub fn service_status(state: State<'_, ServicesState>) -> Result<Vec<ServiceStatus>, String> {
    let mut map = state.0.lock().map_err(|_| "состояние повреждено")?;
    Ok(map
        .iter_mut()
        .map(|(id, r)| {
            let exit = r.child.try_wait().ok().flatten().map(|s| s.code().unwrap_or(-1));
            ServiceStatus { id: id.clone(), running: exit.is_none(), pid: r.child.id(), exit }
        })
        .collect())
}

#[tauri::command]
pub fn service_logs(state: State<'_, ServicesState>, id: String) -> Result<String, String> {
    let map = state.0.lock().map_err(|_| "состояние повреждено")?;
    Ok(map
        .get(&id)
        .and_then(|r| r.log.lock().ok().map(|l| l.iter().cloned().collect::<Vec<_>>().join("\n")))
        .unwrap_or_default())
}

/// Записать файл настроек внутри папки сервера (nginx.conf, Caddyfile…).
#[tauri::command]
pub fn service_write_config(kind: String, rel: String, content: String) -> Result<(), String> {
    let p = inside(&kind, &rel)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn service_path(kind: String, rel: String) -> Result<String, String> {
    Ok(inside(&kind, &rel)?.to_string_lossy().into_owned())
}
