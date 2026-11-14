//! Картинки и видео для оформления: фон редактора.
//!
//! Выбранная картинка копируется в папку настроек Tulpar, поэтому фон не пропадёт,
//! если исходный файл переместить или удалить.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const VIDEO_EXT: &[&str] = &["mp4", "webm", "m4v"];
const MAX_IMAGE: u64 = 20 * 1024 * 1024;
const MAX_VIDEO: u64 = 80 * 1024 * 1024;

#[derive(Serialize)]
pub struct ImageData {
    mime: String,
    base64: String,
}

fn image_ext(path: &Path) -> Result<String, String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| IMAGE_EXT.contains(&e.as_str()) || VIDEO_EXT.contains(&e.as_str()))
        .ok_or_else(|| "поддерживаются картинки PNG, JPG, WebP, GIF, BMP и видео MP4, WebM".to_string())
}

fn is_video(ext: &str) -> bool {
    VIDEO_EXT.contains(&ext)
}

fn check_size(path: &Path) -> Result<(), String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let video = path.extension().and_then(|e| e.to_str()).is_some_and(|e| is_video(&e.to_lowercase()));
    let (limit, what) = if video { (MAX_VIDEO, "видео") } else { (MAX_IMAGE, "картинка") };
    if size > limit {
        return Err(format!("{what} слишком большая ({} МБ, можно до {})", size / 1024 / 1024, limit / 1024 / 1024));
    }
    Ok(())
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Скопировать картинку в папку настроек и вернуть путь к копии.
/// Прежние фоновые картинки удаляются.
#[tauri::command]
pub async fn background_import(path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    let ext = image_ext(&source)?;
    check_size(&source)?;
    let dir = crate::config::dir().ok_or("не удалось определить папку настроек")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Новое имя при каждой замене — чтобы интерфейс увидел, что фон изменился
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = dir.join(format!("background-{stamp}.{ext}"));
    std::fs::copy(&source, &target).map_err(|e| format!("не удалось скопировать картинку: {e}"))?;

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let is_old_background = p != target
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("background-"));
            if is_old_background {
                let _ = std::fs::remove_file(p);
            }
        }
    }
    Ok(target.to_string_lossy().into_owned())
}

/// Прочитать картинку для показа в интерфейсе.
#[tauri::command]
pub async fn image_read(path: String) -> Result<ImageData, String> {
    let file = PathBuf::from(&path);
    let ext = image_ext(&file)?;
    check_size(&file)?;
    let bytes = std::fs::read(&file).map_err(|e| format!("не удалось прочитать {path}: {e}"))?;
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg".to_string(),
        "mp4" | "m4v" => "video/mp4".to_string(),
        "webm" => "video/webm".to_string(),
        other => format!("image/{other}"),
    };
    Ok(ImageData { mime, base64: base64_encode(&bytes) })
}
