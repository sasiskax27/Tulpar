//! Серверы по SSH: команды, файлы и деплой через системный OpenSSH-клиент
//! (в Windows 10/11 он встроен). Пароли Tulpar не хранит — для фоновых
//! команд нужен вход по ключу (BatchMode), а интерактивный вход с паролем
//! идёт через обычный терминал.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Serialize)]
pub struct SshResult {
    code: i32,
    stdout: String,
    stderr: String,
}

fn ssh_command(args: &[String]) -> Command {
    let mut c = Command::new("ssh");
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

fn check_args(args: &[String]) -> Result<(), String> {
    // Только наши флаги и адрес; никаких ProxyCommand и прочих опасных опций из интерфейса
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "-p" | "-i" | "-l" => i += 2,
            "-o" => {
                let opt = args.get(i + 1).map(String::as_str).unwrap_or("");
                let key = opt.split('=').next().unwrap_or("").to_ascii_lowercase();
                if !["batchmode", "connecttimeout", "stricthostkeychecking", "serveraliveinterval"].contains(&key.as_str()) {
                    return Err(format!("опция ssh не разрешена: {opt}"));
                }
                i += 2;
            }
            "-T" | "-q" => i += 1,
            s if s.starts_with('-') => return Err(format!("флаг ssh не разрешён: {s}")),
            _ => i += 1,
        }
    }
    Ok(())
}

fn run(mut cmd: Command, stdin: Option<Vec<u8>>, timeout: Duration) -> Result<SshResult, String> {
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "не найден ssh — в Windows: Параметры → Система → Дополнительные компоненты → «Клиент OpenSSH»".to_string()
        } else {
            e.to_string()
        }
    })?;
    if let Some(data) = stdin {
        let mut pipe = child.stdin.take().ok_or("нет stdin")?;
        std::thread::spawn(move || {
            let _ = pipe.write_all(&data);
        });
    }
    let mut out = child.stdout.take().ok_or("нет stdout")?;
    let mut err = child.stderr.take().ok_or("нет stderr")?;
    let t_out = std::thread::spawn(move || {
        let mut v = Vec::new();
        let _ = out.read_to_end(&mut v);
        v
    });
    let t_err = std::thread::spawn(move || {
        let mut v = Vec::new();
        let _ = err.read_to_end(&mut v);
        v
    });
    let start = Instant::now();
    let code = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status.code().unwrap_or(-1);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return Err("сервер не ответил вовремя".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let stdout = String::from_utf8_lossy(&t_out.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&t_err.join().unwrap_or_default()).into_owned();
    Ok(SshResult { code, stdout, stderr })
}

/// Выполнить команду на сервере. `args` — флаги подключения и user@host.
#[tauri::command]
pub async fn ssh_exec(args: Vec<String>, command: String, stdin: Option<String>, timeout_secs: Option<u64>) -> Result<SshResult, String> {
    check_args(&args)?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(30).clamp(3, 1800));
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = ssh_command(&args);
        cmd.arg(command);
        run(cmd, stdin.map(String::into_bytes), timeout)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Папка для копий файлов с серверов, которые открыты в редакторе.
#[tauri::command]
pub fn ssh_cache_dir() -> Result<String, String> {
    let dir = crate::config::dir().ok_or("нет папки настроек")?.join("remote");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn add_dir(tar: &mut tar::Builder<flate2::write::GzEncoder<Vec<u8>>>, base: &Path, dir: &Path, excludes: &[String], count: &mut usize) -> Result<(), String> {
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if excludes.iter().any(|x| x == &name) {
            continue;
        }
        let path = e.path();
        let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
        let rel_unix: PathBuf = rel.components().collect();
        let ft = e.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            add_dir(tar, base, &path, excludes, count)?;
        } else if ft.is_file() {
            tar.append_path_with_name(&path, &rel_unix).map_err(|e| format!("{}: {e}", rel.display()))?;
            *count += 1;
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct DeployResult {
    files: usize,
    bytes: usize,
    output: String,
    code: i32,
}

/// Залить папку проекта на сервер (tar.gz через ssh) и выполнить команду после.
#[tauri::command]
pub async fn ssh_deploy(args: Vec<String>, local_dir: String, remote_dir: String, excludes: Vec<String>, after: String) -> Result<DeployResult, String> {
    check_args(&args)?;
    if remote_dir.trim().is_empty() || remote_dir.trim() == "/" {
        return Err("укажите папку на сервере".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let base = PathBuf::from(&local_dir);
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()));
        let mut files = 0usize;
        add_dir(&mut tar, &base, &base, &excludes, &mut files)?;
        let data = tar.into_inner().map_err(|e| e.to_string())?.finish().map_err(|e| e.to_string())?;
        let bytes = data.len();
        let dir = shell_quote(remote_dir.trim());
        let mut remote = format!("mkdir -p {dir} && tar -xzf - -C {dir}");
        if !after.trim().is_empty() {
            remote.push_str(&format!(" && cd {dir} && {}", after.trim()));
        }
        let mut cmd = ssh_command(&args);
        cmd.arg(remote);
        let r = run(cmd, Some(data), Duration::from_secs(1800))?;
        Ok(DeployResult { files, bytes, output: format!("{}{}", r.stdout, r.stderr), code: r.code })
    })
    .await
    .map_err(|e| e.to_string())?
}
