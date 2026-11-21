//! Обновления с GitHub Releases. Tulpar спрашивает у GitHub последний релиз
//! (один запрос, без данных о пользователе) и, если он новее, предлагает
//! обновиться: скачивает установщик и запускает его.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

const REPO: &str = "sasiskax27/Tulpar";
const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current: String,
    version: String,
    page: String,
    notes: String,
    /// Установщик для этой системы (если есть в релизе)
    asset_url: Option<String>,
    asset_name: Option<String>,
}

/// «v0.2.10» → [0, 2, 10]
fn parse(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split(['.', '-', '+'])
        .take(3)
        .map(|p| p.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0))
        .collect()
}

fn newer(candidate: &str, current: &str) -> bool {
    let (mut a, mut b) = (parse(candidate), parse(current));
    a.resize(3, 0);
    b.resize(3, 0);
    a > b
}

/// Какой файл релиза подходит этой системе.
fn pick_asset(assets: &[Value]) -> Option<(String, String)> {
    let wanted: &[&str] = if cfg!(windows) {
        &["-setup.exe", ".msi"]
    } else if cfg!(target_os = "macos") {
        &[".dmg"]
    } else {
        &[".appimage", ".deb"]
    };
    for suffix in wanted {
        for a in assets {
            let name = a["name"].as_str().unwrap_or("");
            if name.to_lowercase().ends_with(suffix) {
                if let Some(url) = a["browser_download_url"].as_str() {
                    return Some((url.to_owned(), name.to_owned()));
                }
            }
        }
    }
    None
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Tulpar/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

/// Есть ли новая версия. None — у вас последняя.
#[tauri::command]
pub async fn update_check() -> Result<Option<UpdateInfo>, String> {
    let response = client()?
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| if e.is_connect() { "нет связи с GitHub".to_string() } else { e.to_string() })?;
    if response.status().as_u16() == 404 {
        return Ok(None); // релизов ещё нет
    }
    if !response.status().is_success() {
        return Err(format!("GitHub ответил {}", response.status().as_u16()));
    }
    let v: Value = response.json().await.map_err(|e| e.to_string())?;
    let tag = v["tag_name"].as_str().unwrap_or("");
    if tag.is_empty() || !newer(tag, CURRENT) {
        return Ok(None);
    }
    let asset = pick_asset(v["assets"].as_array().map(Vec::as_slice).unwrap_or(&[]));
    Ok(Some(UpdateInfo {
        current: CURRENT.to_owned(),
        version: tag.trim_start_matches(['v', 'V']).to_owned(),
        page: v["html_url"].as_str().unwrap_or("").to_owned(),
        notes: v["body"].as_str().unwrap_or("").chars().take(2000).collect(),
        asset_url: asset.as_ref().map(|a| a.0.clone()),
        asset_name: asset.map(|a| a.1),
    }))
}

fn allowed_url(url: &str) -> bool {
    url.starts_with(&format!("https://github.com/{REPO}/"))
        || url.starts_with(&format!("https://github.com/{}/", REPO.to_lowercase()))
}

/// Скачать установщик новой версии, запустить его и закрыть Tulpar.
#[tauri::command]
pub async fn update_install(app: AppHandle, url: String, name: String) -> Result<(), String> {
    if !allowed_url(&url) {
        return Err("адрес обновления не из репозитория Tulpar".into());
    }
    let safe_name: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "._-".contains(*c)).collect();
    if safe_name.is_empty() {
        return Err("некорректное имя файла".into());
    }
    let response = client()?.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("не удалось скачать: {}", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("загрузка прервалась: {e}"))?;
    let path = std::env::temp_dir().join(&safe_name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    let lower = safe_name.to_lowercase();
    let spawned = if lower.ends_with(".msi") {
        std::process::Command::new("msiexec").arg("/i").arg(&path).spawn()
    } else if lower.ends_with(".exe") {
        std::process::Command::new(&path).spawn()
    } else {
        // .dmg, .AppImage, .deb — открыть системой, пусть пользователь установит
        return open_path(&path.to_string_lossy());
    };
    spawned.map_err(|e| format!("не удалось запустить установщик: {e}"))?;
    // Установщику нужно заменить файлы — освобождаем их
    app.exit(0);
    Ok(())
}

fn open_path(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd").args(["/C", "start", "", target]).creation_flags(0x0800_0000).spawn()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(target).spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(target).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Открыть страницу GitHub в браузере (вход в Copilot и подобное).
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("можно открыть только страницы github.com".into());
    }
    open_path(&url)
}

/// Открыть страницу релиза в браузере.
#[tauri::command]
pub async fn update_open_page(url: String) -> Result<(), String> {
    if !allowed_url(&url) {
        return Err("можно открыть только страницу репозитория Tulpar".into());
    }
    open_path(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(newer("v0.2.0", "0.1.0"));
        assert!(newer("0.1.10", "0.1.9"));
        assert!(newer("v1.0", "0.9.9"));
        assert!(!newer("v0.1.0", "0.1.0"));
        assert!(!newer("0.1.0-beta", "0.1.0"));
        assert!(!newer("v0.0.9", "0.1.0"));
    }

    #[test]
    fn only_repo_urls() {
        assert!(allowed_url("https://github.com/sasiskax27/Tulpar/releases/download/v0.2.0/Tulpar_0.2.0_x64-setup.exe"));
        assert!(!allowed_url("https://evil.example/Tulpar.exe"));
        assert!(!allowed_url("https://github.com/someone/else/x.exe"));
    }
}
