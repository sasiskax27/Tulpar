//! Локальный ИИ через Ollama: проверка, список установленных моделей,
//! скачивание с прогрессом и удаление. Плюс сведения о памяти компьютера,
//! чтобы подсказать, какая модель на нём запустится.

use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    ram_gb: Option<f64>,
    vram_gb: Option<f64>,
}

#[derive(Serialize)]
pub struct InstalledModel {
    name: String,
    size: u64,
}

#[derive(Serialize)]
pub struct OllamaStatus {
    running: bool,
    models: Vec<InstalledModel>,
}

#[derive(Serialize, Clone)]
struct PullProgress {
    model: String,
    status: String,
    completed: u64,
    total: u64,
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn ram_bytes() -> Option<f64> {
    if cfg!(windows) {
        run(
            "powershell",
            &["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
        )?
        .trim()
        .parse()
        .ok()
    } else if cfg!(target_os = "macos") {
        run("sysctl", &["-n", "hw.memsize"])?.trim().parse().ok()
    } else {
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
        let kb: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kb * 1024.0)
    }
}

/// Память видеокарты NVIDIA в МБ (самой большой, если их несколько).
fn vram_mb() -> Option<f64> {
    run("nvidia-smi", &["--query-gpu=memory.total", "--format=csv,noheader,nounits"])?
        .lines()
        .filter_map(|l| l.trim().parse::<f64>().ok())
        .fold(None, |best: Option<f64>, v| Some(best.map_or(v, |b| b.max(v))))
}

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

#[tauri::command]
pub async fn system_memory() -> Result<Memory, String> {
    Ok(Memory {
        ram_gb: ram_bytes().map(|b| b / GB),
        vram_gb: vram_mb().map(|mb| mb / 1024.0),
    })
}

fn host_of(host: &str) -> String {
    host.trim().trim_end_matches('/').to_owned()
}

/// Запущена ли Ollama и какие модели установлены.
#[tauri::command]
pub async fn ollama_status(host: String) -> Result<OllamaStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    let offline = OllamaStatus { running: false, models: Vec::new() };
    let Ok(response) = client.get(format!("{}/api/tags", host_of(&host))).send().await else {
        return Ok(offline);
    };
    let Ok(value) = response.json::<Value>().await else {
        return Ok(offline);
    };
    let models = value["models"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|m| {
                    Some(InstalledModel {
                        name: m["name"].as_str()?.to_owned(),
                        size: m["size"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(OllamaStatus { running: true, models })
}

/// Скачать модель. Ход загрузки уходит в интерфейс событиями `ollama:progress`.
#[tauri::command]
pub async fn ollama_pull(app: AppHandle, host: String, model: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .post(format!("{}/api/pull", host_of(&host)))
        .json(&json!({ "model": model, "stream": true }))
        .send()
        .await
        .map_err(|_| "Ollama не отвечает. Она запущена?".to_string())?;

    // Ответ — поток строк JSON, по одной на каждое обновление
    let mut buffer: Vec<u8> = Vec::new();
    let handle = |line: &[u8]| -> Result<(), String> {
        let Ok(value) = serde_json::from_slice::<Value>(line) else {
            return Ok(());
        };
        if let Some(error) = value["error"].as_str() {
            return Err(error.to_owned());
        }
        let _ = app.emit(
            "ollama:progress",
            PullProgress {
                model: model.clone(),
                status: value["status"].as_str().unwrap_or_default().to_owned(),
                completed: value["completed"].as_u64().unwrap_or(0),
                total: value["total"].as_u64().unwrap_or(0),
            },
        );
        Ok(())
    };
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("загрузка прервалась: {e}"))? {
        buffer.extend_from_slice(&chunk);
        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buffer.drain(..=pos).collect();
            handle(&line)?;
        }
    }
    handle(&buffer)
}

/// Удалить модель с диска.
#[tauri::command]
pub async fn ollama_delete(host: String, model: String) -> Result<(), String> {
    let response = reqwest::Client::new()
        .delete(format!("{}/api/delete", host_of(&host)))
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|_| "Ollama не отвечает. Она запущена?".to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("не удалось удалить модель (ошибка {})", response.status().as_u16()))
    }
}
