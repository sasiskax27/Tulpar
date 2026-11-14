//! Файлы настроек пользователя: settings.json, keybindings.json, layout.json, languages.json.
//!
//! Лежат в ~/.config/tulpar (Linux), ~/Library/Application Support/tulpar (macOS),
//! %APPDATA%\tulpar (Windows). Любое изменение сразу уходит в интерфейс событием
//! `config:changed`, поэтому перезапуск не нужен.

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const ALLOWED: &[&str] = &["settings.json", "keybindings.json", "layout.json", "languages.json"];

#[derive(Default)]
pub struct ConfigState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Serialize, Clone)]
struct ConfigChanged {
    name: String,
}

pub fn dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("tulpar"))
}

fn template(name: &str) -> &'static str {
    match name {
        "settings.json" => "{\n  // Настройки Tulpar. Ключи — как в VS Code, например:\n  // \"editor.fontSize\": 15,\n  // \"workbench.colorTheme\": \"light\",\n  // \"files.autoSave\": \"afterDelay\"\n}\n",
        "keybindings.json" => "[\n  // Сочетания клавиш в формате VS Code, например:\n  // { \"key\": \"ctrl+shift+e\", \"command\": \"workbench.action.toggleSidebarVisibility\" },\n  // Отменить стандартное сочетание — минус перед командой:\n  // { \"key\": \"ctrl+b\", \"command\": \"-workbench.action.toggleSidebarVisibility\" }\n]\n",
        "languages.json" => "{\n  // Языковые серверы (LSP). Ключ — id языка, как в строке статуса.\n  // Пример — подключить TypeScript через сервер вместо встроенного:\n  // \"typescript\": { \"command\": \"typescript-language-server\", \"args\": [\"--stdio\"] },\n  // Отключить сервер для языка:\n  // \"python\": null\n}\n",
        _ => "{\n  // Раскладки панелей. Слоты: left, center, bottom, right.\n  // Панели: explorer, editor, terminal.\n  \"layouts\": {\n    \"Код\": { \"left\": [\"explorer\"], \"center\": [\"editor\"], \"bottom\": [\"terminal\"] },\n    \"Фокус\": { \"center\": [\"editor\"] }\n  },\n  \"default\": \"Код\"\n}\n",
    }
}

/// Путь к файлу настроек; если файла ещё нет — создаётся с подсказками внутри.
#[tauri::command]
pub async fn config_ensure(name: String) -> Result<String, String> {
    if !ALLOWED.contains(&name.as_str()) {
        return Err(format!("неизвестный файл настроек: {name}"));
    }
    let dir = dir().ok_or("не удалось определить папку настроек")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    if !path.exists() {
        std::fs::write(&path, template(&name)).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Прочитать файл настроек. Если файла нет — null (интерфейс возьмёт значения по умолчанию).
#[tauri::command]
pub async fn config_read(name: String) -> Result<Option<String>, String> {
    if !ALLOWED.contains(&name.as_str()) {
        return Err(format!("неизвестный файл настроек: {name}"));
    }
    let Some(path) = dir().map(|d| d.join(&name)) else {
        return Ok(None);
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Путь к папке настроек — чтобы показать пользователю и открыть файл в редакторе.
#[tauri::command]
pub async fn config_dir() -> Result<String, String> {
    dir()
        .map(|d| d.to_string_lossy().into_owned())
        .ok_or_else(|| "не удалось определить папку настроек".into())
}

pub fn start_watching(app: AppHandle) {
    let Some(dir) = dir() else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let emitter = app.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        for path in event.paths {
            let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else {
                continue;
            };
            if ALLOWED.contains(&name.as_str()) {
                let _ = emitter.emit("config:changed", ConfigChanged { name });
            }
        }
    });
    let Ok(mut watcher) = watcher else { return };
    if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
        return;
    }
    let state: State<ConfigState> = app.state();
    if let Ok(mut slot) = state.watcher.lock() {
        *slot = Some(watcher);
    };
}
