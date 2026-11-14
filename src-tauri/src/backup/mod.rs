//! Резервные копии несохранённых правок. Если Tulpar закрылся с несохранёнными
//! файлами — выключили свет, вылетело, закрыли окно — при следующем запуске
//! правки можно вернуть. Копии лежат в папке настроек, в `backups/`.

use std::path::PathBuf;

fn dir() -> Result<PathBuf, String> {
    let d = crate::config::dir().ok_or("не удалось определить папку настроек")?.join("backups");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Имя копии придумывает интерфейс (хеш пути). Разрешаем только безопасные символы,
/// чтобы имя не могло указать за пределы папки копий.
fn file(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.len() > 64 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("некорректное имя копии".into());
    }
    Ok(dir()?.join(format!("{name}.json")))
}

#[tauri::command]
pub async fn backup_put(name: String, data: String) -> Result<(), String> {
    let path = file(&name)?;
    crate::workspace::atomic_write(&path, data.as_bytes())
}

#[tauri::command]
pub async fn backup_delete(name: String) -> Result<(), String> {
    match std::fs::remove_file(file(&name)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Все копии: (имя, содержимое).
#[tauri::command]
pub async fn backup_list() -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir()?).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else { continue };
        if let Ok(data) = std::fs::read_to_string(&path) {
            out.push((name, data));
        }
    }
    Ok(out)
}
