//! Языковые серверы (LSP). Ядро здесь — прозрачная «труба»: запускает сервер как
//! подпроцесс и пересылает JSON-RPC сообщения между ним и интерфейсом.
//! Весь протокол (initialize, автодополнение, диагностика…) реализован в
//! src/lsp/*.ts — так его проще развивать и отлаживать.
//!
//! Команду запуска берём из languages.json — того же доверия, что и терминал:
//! пользователь сам решает, что запускать.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

struct Server {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct LspState {
    servers: Mutex<HashMap<u32, Server>>,
    next_id: AtomicU32,
}

impl LspState {
    /// Остановить все серверы — при выходе из Tulpar, чтобы не оставлять процессы.
    pub fn kill_all(&self) {
        if let Ok(mut servers) = self.servers.lock() {
            for (_, mut server) in servers.drain() {
                let _ = server.child.kill();
                let _ = server.child.wait();
            }
        }
    }
}

#[derive(Serialize, Clone)]
struct LspMessage {
    id: u32,
    message: String,
}

#[derive(Serialize, Clone)]
struct LspExit {
    id: u32,
}

fn build_command(command: &str, args: &[String], cwd: Option<&str>, via_shell: bool) -> Command {
    let mut cmd = if via_shell {
        // На Windows npm и pip ставят серверы как .cmd-обёртки, которые
        // запускаются только через cmd.exe
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command).args(args);
        c
    } else {
        let mut c = Command::new(command);
        c.args(args);
        c
    };
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn spawn(command: &str, args: &[String], cwd: Option<&str>) -> std::io::Result<Child> {
    match build_command(command, args, cwd, false).spawn() {
        Err(e) if cfg!(windows) && e.kind() == std::io::ErrorKind::NotFound => {
            build_command(command, args, cwd, true).spawn()
        }
        other => other,
    }
}

/// Прочитать одно сообщение LSP: заголовки «Content-Length: N», пустая строка, N байт тела.
fn read_message(reader: &mut impl BufRead) -> Option<String> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None; // сервер закрыл поток
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("Content-Length:") {
            length = value.trim().parse().ok();
        }
    }
    let mut body = vec![0u8; length?];
    reader.read_exact(&mut body).ok()?;
    Some(String::from_utf8_lossy(&body).into_owned())
}

/// Запустить языковой сервер. Возвращает его id для lsp_send / lsp_stop.
/// Если программа не найдена — ошибка начинается с «not-found:», интерфейс
/// по ней предлагает установить сервер.
#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let mut child = spawn(&command, &args, cwd.as_deref()).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("not-found:{command}")
        } else {
            format!("не удалось запустить {command}: {e}")
        }
    })?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let stdin = child.stdin.take().ok_or("нет stdin")?;
    let stdout = child.stdout.take().ok_or("нет stdout")?;
    let stderr = child.stderr.take();

    let emitter = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(message) = read_message(&mut reader) {
            let _ = emitter.emit("lsp:message", LspMessage { id, message });
        }
        let _ = emitter.emit("lsp:exit", LspExit { id });
    });

    if let Some(stderr) = stderr {
        // Логи сервера — в консоль разработчика; позже выведем в панель «Вывод»
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[lsp {id}] {line}");
            }
        });
    }

    state
        .servers
        .lock()
        .map_err(|_| "состояние повреждено")?
        .insert(id, Server { child, stdin });
    Ok(id)
}

/// Отправить серверу одно JSON-RPC сообщение.
#[tauri::command]
pub async fn lsp_send(state: State<'_, LspState>, id: u32, message: String) -> Result<(), String> {
    let mut servers = state.servers.lock().map_err(|_| "состояние повреждено")?;
    let server = servers.get_mut(&id).ok_or("сервер не запущен")?;
    let header = format!("Content-Length: {}\r\n\r\n", message.len());
    server
        .stdin
        .write_all(header.as_bytes())
        .and_then(|_| server.stdin.write_all(message.as_bytes()))
        .and_then(|_| server.stdin.flush())
        .map_err(|e| e.to_string())
}

/// Остановить сервер (интерфейс перед этим вежливо шлёт shutdown/exit).
#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspState>, id: u32) -> Result<(), String> {
    let server = state
        .servers
        .lock()
        .map_err(|_| "состояние повреждено")?
        .remove(&id);
    if let Some(mut server) = server {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
    Ok(())
}
