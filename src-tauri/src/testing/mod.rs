//! Запуск тестов для панели «Тесты». Как agent_run, но с отчётом: в команде
//! можно написать {report} — туда подставится путь к временному файлу, куда
//! тестовый фреймворк пишет результаты (JUnit XML, JSON). Отчёт читается и
//! удаляется, папка проекта не засоряется.

use std::io::Read;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::ai::agent::shell_command;
use crate::workspace::{current_root, WorkspaceState};

const MAX_OUTPUT: usize = 200_000;
const MAX_REPORT: u64 = 20 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    code: Option<i32>,
    output: String,
    report: Option<String>,
    timed_out: bool,
    millis: u64,
}

/// Путь для подстановки в команду: в кавычках, с экранированием под оболочку.
fn quoted(path: &str) -> String {
    if cfg!(windows) {
        format!("'{}'", path.replace('\'', "''"))
    } else {
        format!("'{}'", path.replace('\'', "'\\''"))
    }
}

#[tauri::command]
pub async fn tests_run(state: State<'_, WorkspaceState>, command: String, report_ext: Option<String>) -> Result<TestRun, String> {
    let root = current_root(&state)?;
    let ext = report_ext.unwrap_or_else(|| "txt".into());
    if !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("некорректное расширение отчёта".into());
    }
    let report_path = std::env::temp_dir().join(format!(
        "tulpar-tests-{}-{}.{ext}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
    ));
    let report_str = report_path.to_string_lossy().into_owned();
    let command = command.replace("{report}", &quoted(&report_str));

    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut child = shell_command(&command)
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .env("CI", "1")
            .env("FORCE_COLOR", "0")
            .env("NO_COLOR", "1")
            .spawn()
            .map_err(|e| format!("не удалось запустить: {e}"))?;
        let mut out = child.stdout.take().unwrap();
        let mut err = child.stderr.take().unwrap();
        let ro = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = out.read_to_end(&mut b);
            b
        });
        let re = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = err.read_to_end(&mut b);
            b
        });
        let timeout = Duration::from_secs(900);
        let mut timed_out = false;
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
                break Some(s);
            }
            if started.elapsed() > timeout {
                let _ = child.kill();
                let _ = child.wait();
                timed_out = true;
                break None;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let mut output = String::from_utf8_lossy(&ro.join().unwrap_or_default()).into_owned();
        let errors = String::from_utf8_lossy(&re.join().unwrap_or_default()).into_owned();
        if !errors.trim().is_empty() {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            output.push_str(&errors);
        }
        if output.len() > MAX_OUTPUT {
            let mut cut = output.len() - MAX_OUTPUT;
            while !output.is_char_boundary(cut) {
                cut += 1;
            }
            output = format!("…(начало вывода обрезано)\n{}", &output[cut..]);
        }
        let report = match std::fs::metadata(&report_path) {
            Ok(m) if m.len() <= MAX_REPORT => std::fs::read(&report_path).ok().map(|b| String::from_utf8_lossy(&b).into_owned()),
            _ => None,
        };
        let _ = std::fs::remove_file(&report_path);
        Ok(TestRun {
            code: status.and_then(|s| s.code()),
            output,
            report,
            timed_out,
            millis: started.elapsed().as_millis() as u64,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// JUnit-отчёты Maven/Gradle лежат в папке проекта: вернуть их содержимое.
#[tauri::command]
pub async fn tests_junit_reports(state: State<'_, WorkspaceState>, dirs: Vec<String>) -> Result<Vec<String>, String> {
    let root = current_root(&state)?;
    let mut out = Vec::new();
    for d in dirs {
        if d.contains("..") {
            continue;
        }
        let dir = root.join(&d);
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let is_xml = p.extension().map(|x| x == "xml").unwrap_or(false);
            if !is_xml || !p.file_name().map(|n| n.to_string_lossy().starts_with("TEST-")).unwrap_or(false) {
                continue;
            }
            if e.metadata().map(|m| m.len() > MAX_REPORT).unwrap_or(true) {
                continue;
            }
            if let Ok(b) = std::fs::read(&p) {
                out.push(String::from_utf8_lossy(&b).into_owned());
            }
        }
    }
    Ok(out)
}
