//! Встроенный терминал. Каждая вкладка терминала — псевдотерминал (PTY) с оболочкой
//! внутри: ConPTY на Windows, обычный pty на macOS и Linux.
//!
//! id терминала придумывает интерфейс (случайная строка), чтобы подписаться на
//! вывод ещё до запуска и не потерять первые строки.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalState {
    terms: Mutex<HashMap<String, Term>>,
}

impl TerminalState {
    /// Завершить все оболочки — при выходе из Tulpar и при перезагрузке интерфейса.
    pub fn kill_all(&self) {
        if let Ok(mut terms) = self.terms.lock() {
            for (_, mut term) in terms.drain() {
                let _ = term.killer.kill();
            }
        }
    }
}

#[derive(Serialize, Clone)]
struct TerminalData {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct TerminalExit {
    id: String,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn default_shell() -> String {
    if cfg!(windows) {
        "powershell.exe".into()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

/// Забрать из буфера всё, что уже является целым текстом UTF-8. Символ, разрезанный
/// границей чтения (кириллица — 2 байта, эмодзи — 4), остаётся в буфере до следующей порции.
fn drain_utf8(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(s) => {
                out.push_str(s);
                pending.clear();
                break;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(&String::from_utf8_lossy(&pending[..valid]));
                match e.error_len() {
                    // Неверные байты посреди потока — заменяем и идём дальше
                    Some(len) => {
                        out.push('\u{FFFD}');
                        pending.drain(..valid + len);
                    }
                    // Незаконченный символ в конце — ждём продолжения
                    None => {
                        pending.drain(..valid);
                        break;
                    }
                }
            }
        }
    }
    out
}

/// Запустить оболочку в новом терминале.
#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let shell = shell.filter(|s| !s.trim().is_empty()).unwrap_or_else(default_shell);
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| format!("не удалось создать терминал: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let dir = cwd
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(dirs::home_dir);
    if let Some(dir) = dir {
        cmd.cwd(dir);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("не удалось запустить {shell}: {e}"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    state
        .terms
        .lock()
        .map_err(|_| "состояние повреждено")?
        .insert(id.clone(), Term { master: pair.master, writer, killer });

    // Вывод оболочки → интерфейс
    let emitter = app.clone();
    let reader_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let data = drain_utf8(&mut pending);
                    if !data.is_empty() {
                        let _ = emitter.emit("terminal:data", TerminalData { id: reader_id.clone(), data });
                    }
                }
            }
        }
    });

    // Оболочка завершилась (exit или kill) → убираем терминал и сообщаем интерфейсу.
    // Удаление записи закрывает PTY, и поток чтения выше тоже заканчивается.
    let waiter_app = app.clone();
    let waiter_id = id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        // Даём потоку чтения дочитать последние строки
        std::thread::sleep(std::time::Duration::from_millis(100));
        if let Ok(mut terms) = waiter_app.state::<TerminalState>().terms.lock() {
            terms.remove(&waiter_id);
        }
        let _ = waiter_app.emit("terminal:exit", TerminalExit { id: waiter_id });
    });

    Ok(shell)
}

/// Ввод с клавиатуры → оболочка.
#[tauri::command]
pub async fn terminal_write(state: State<'_, TerminalState>, id: String, data: String) -> Result<(), String> {
    let mut terms = state.terms.lock().map_err(|_| "состояние повреждено")?;
    let term = terms.get_mut(&id).ok_or("терминал закрыт")?;
    term.writer
        .write_all(data.as_bytes())
        .and_then(|_| term.writer.flush())
        .map_err(|e| e.to_string())
}

/// Размер окна терминала изменился.
#[tauri::command]
pub async fn terminal_resize(state: State<'_, TerminalState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let terms = state.terms.lock().map_err(|_| "состояние повреждено")?;
    if let Some(term) = terms.get(&id) {
        term.master.resize(size(cols, rows)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Закрыть один терминал.
#[tauri::command]
pub async fn terminal_kill(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    let mut terms = state.terms.lock().map_err(|_| "состояние повреждено")?;
    if let Some(term) = terms.get_mut(&id) {
        let _ = term.killer.kill();
    }
    Ok(())
}

/// Закрыть все терминалы: интерфейс зовёт это при старте, чтобы после
/// перезагрузки страницы не оставалось оболочек без окна.
#[tauri::command]
pub async fn terminal_reset(state: State<'_, TerminalState>) -> Result<(), String> {
    state.kill_all();
    Ok(())
}
