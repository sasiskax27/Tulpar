//! Встроенный сборщик: запускает команду сборки в папке проекта и построчно
//! шлёт вывод во фронтенд (панель «Сборка» разбирает ошибки, показывает прогресс).
//! Папка — только внутри открытого проекта или папки Tulpar; отмена убивает
//! всё дерево процессов (Gradle, npm, cargo запускают дочерние).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::ai::agent::shell_command;
use crate::workspace::{resolve, WorkspaceState};

#[derive(Default)]
pub struct BuildState {
    running: Arc<Mutex<HashMap<String, Child>>>,
}

impl BuildState {
    pub fn kill_all(&self) {
        if let Ok(mut map) = self.running.lock() {
            for (_, child) in map.iter_mut() {
                kill_tree(child);
            }
            map.clear();
        }
    }
}

fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    line: String,
    err: bool,
}

#[derive(Clone, Serialize)]
struct Done {
    id: String,
    code: Option<i32>,
    ms: u64,
    cancelled: bool,
}

/// Запустить сборку. `stdin` — что подать на вход (например, «y» на лицензии,
/// когда человек сам нажал «Принимаю»). `env` — переменные (ANDROID_HOME и т.п.).
#[tauri::command]
pub fn build_start(
    app: AppHandle,
    state: State<'_, BuildState>,
    ws: State<'_, WorkspaceState>,
    id: String,
    cwd: String,
    command: String,
    env: Option<HashMap<String, String>>,
    stdin: Option<String>,
) -> Result<(), String> {
    let dir = resolve(&ws, &cwd)?;
    if !dir.is_dir() {
        return Err("папка сборки не найдена".into());
    }
    let mut map = state.running.lock().map_err(|_| "состояние повреждено")?;
    if let Some(old) = map.get_mut(&id) {
        if matches!(old.try_wait(), Ok(None)) {
            return Err("эта сборка уже идёт".into());
        }
    }
    let mut cmd = shell_command(&command);
    cmd.current_dir(&dir)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("TERM", "dumb")
        // Gradle без «живого» вывода с перерисовкой строк — его удобно читать построчно
        .env("GRADLE_OPTS", "-Dorg.gradle.console=plain");
    for (k, v) in env.unwrap_or_default() {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| format!("не удалось запустить: {e}"))?;
    if let (Some(text), Some(mut input)) = (stdin, child.stdin.take()) {
        std::thread::spawn(move || {
            let _ = input.write_all(text.as_bytes());
        });
    }
    let started = Instant::now();
    for (pipe, err) in [(child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), false), (child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>), true)] {
        let Some(pipe) = pipe else { continue };
        let app = app.clone();
        let id = id.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(pipe);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_owned();
                        let _ = app.emit("build:line", Line { id: id.clone(), line, err });
                    }
                }
            }
        });
    }
    map.insert(id.clone(), child);
    drop(map);

    // Ждём завершения в отдельном потоке и сообщаем код выхода
    let running = state.running.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let mut map = match running.lock() {
            Ok(m) => m,
            Err(_) => return,
        };
        let Some(child) = map.get_mut(&id) else {
            // убрали через build_cancel
            let _ = app.emit("build:done", Done { id: id.clone(), code: None, ms: started.elapsed().as_millis() as u64, cancelled: true });
            return;
        };
        if let Ok(Some(status)) = child.try_wait() {
            map.remove(&id);
            drop(map);
            // Дать потокам чтения дослать последние строки
            std::thread::sleep(std::time::Duration::from_millis(150));
            let _ = app.emit("build:done", Done { id, code: status.code(), ms: started.elapsed().as_millis() as u64, cancelled: false });
            return;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn build_cancel(state: State<'_, BuildState>, id: String) -> Result<(), String> {
    let mut map = state.running.lock().map_err(|_| "состояние повреждено")?;
    if let Some(mut child) = map.remove(&id) {
        kill_tree(&mut child);
    }
    Ok(())
}
