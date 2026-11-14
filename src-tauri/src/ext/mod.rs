//! Расширения из Open VSX (открытый каталог расширений VS Code).
//! Код расширений VS Code в Tulpar не выполняется — берём из них только
//! «декларативные» части: цветовые темы и сниппеты. Расширение скачивается
//! как .vsix (это zip), нужные файлы разбираются и складываются в
//! <папка настроек>/extensions/<id>/, список установленных — в index.json.

use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

const API: &str = "https://open-vsx.org/api";
const MAX_VSIX: usize = 80 * 1024 * 1024;
const MAX_ENTRY: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry {
    pub label: String,
    /// vs | vs-dark | hc-black | hc-light
    pub ui_theme: String,
    pub file: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnippetEntry {
    pub language: String,
    pub file: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub themes: Vec<ThemeEntry>,
    pub snippets: Vec<SnippetEntry>,
}

fn root() -> Result<PathBuf, String> {
    crate::config::dir().map(|d| d.join("extensions")).ok_or_else(|| "нет папки настроек".to_string())
}

fn read_index() -> Vec<Installed> {
    root()
        .ok()
        .and_then(|r| std::fs::read_to_string(r.join("index.json")).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_index(list: &[Installed]) -> Result<(), String> {
    let r = root()?;
    std::fs::create_dir_all(&r).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(r.join("index.json"), text).map_err(|e| e.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Tulpar/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())
}

fn net_error(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "нет связи с open-vsx.org".into()
    } else {
        e.to_string()
    }
}

fn safe_part(s: &str) -> bool {
    !s.is_empty() && s.len() < 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) && !s.starts_with('.')
}

/// JSON с комментариями и висячими запятыми (как пишут темы VS Code) → обычный JSON.
pub fn strip_jsonc(src: &str) -> String {
    let chars: Vec<char> = src.trim_start_matches('\u{feff}').chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                let d = chars[i];
                out.push(d);
                i += 1;
                if d == '\\' && i < chars.len() {
                    out.push(chars[i]);
                    i += 1;
                } else if d == '"' {
                    break;
                }
            }
        } else if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else if c == ',' {
            // Висячая запятая: дальше только пробелы/комментарии и закрывающая скобка
            let mut j = i + 1;
            loop {
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if chars.get(j) == Some(&'/') && chars.get(j + 1) == Some(&'/') {
                    while j < chars.len() && chars[j] != '\n' {
                        j += 1;
                    }
                } else if chars.get(j) == Some(&'/') && chars.get(j + 1) == Some(&'*') {
                    j += 2;
                    while j + 1 < chars.len() && !(chars[j] == '*' && chars[j + 1] == '/') {
                        j += 1;
                    }
                    j += 2;
                } else {
                    break;
                }
            }
            if !matches!(chars.get(j), Some('}') | Some(']')) {
                out.push(c);
            }
            i += 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

/// Путь внутри архива: «extension/» + относительный путь из package.json, с разбором ./ и ../
pub fn zip_path(base_dir: &str, rel: &str) -> String {
    let rel = rel.replace('\\', "/");
    let mut parts: Vec<&str> = base_dir.split('/').filter(|p| !p.is_empty()).collect();
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                if parts.len() > 1 {
                    parts.pop();
                }
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn dir_of(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[..i].to_string(),
        None => String::new(),
    }
}

struct Vsix {
    zip: zip::ZipArchive<Cursor<Vec<u8>>>,
}

impl Vsix {
    fn read(&mut self, name: &str) -> Option<String> {
        let mut file = self.zip.by_name(name).ok()?;
        if file.size() > MAX_ENTRY {
            return None;
        }
        let mut s = String::new();
        file.read_to_string(&mut s).ok()?;
        Some(s)
    }

    fn json(&mut self, name: &str) -> Option<Value> {
        let text = self.read(name)?;
        serde_json::from_str(&strip_jsonc(&text)).ok()
    }

    /// Тема с учётом «include»: цвета дочерней поверх базовых, tokenColors — базовые, затем свои.
    fn theme(&mut self, path: &str, depth: u32) -> Option<Value> {
        let mut theme = self.json(path)?;
        let mut colors = Map::new();
        let mut tokens: Vec<Value> = Vec::new();
        if depth < 5 {
            if let Some(inc) = theme.get("include").and_then(Value::as_str).map(str::to_owned) {
                if let Some(base) = self.theme(&zip_path(&dir_of(path), &inc), depth + 1) {
                    if let Some(c) = base.get("colors").and_then(Value::as_object) {
                        colors.extend(c.clone());
                    }
                    if let Some(t) = base.get("tokenColors").and_then(Value::as_array) {
                        tokens.extend(t.iter().cloned());
                    }
                }
            }
        }
        if let Some(c) = theme.get("colors").and_then(Value::as_object) {
            colors.extend(c.clone());
        }
        // tokenColors строкой — ссылка на .tmTheme (plist), такие пропускаем
        if let Some(t) = theme.get("tokenColors").and_then(Value::as_array) {
            tokens.extend(t.iter().cloned());
        }
        let obj = theme.as_object_mut()?;
        obj.remove("include");
        obj.insert("colors".into(), Value::Object(colors));
        obj.insert("tokenColors".into(), Value::Array(tokens));
        Some(theme)
    }
}

/// Поиск в Open VSX. category: Themes, Snippets или пусто.
#[tauri::command]
pub async fn ext_search(query: String, category: Option<String>) -> Result<Vec<Value>, String> {
    let mut params: Vec<(&str, String)> = vec![
        ("query", query.trim().to_string()),
        ("size", "40".into()),
        ("sortBy", if query.trim().is_empty() { "downloadCount".into() } else { "relevance".into() }),
        ("sortOrder", "desc".into()),
    ];
    if let Some(c) = category.filter(|c| !c.is_empty()) {
        params.push(("category", c));
    }
    let response = client()?.get(format!("{API}/-/search")).query(&params).send().await.map_err(net_error)?;
    if !response.status().is_success() {
        return Err(format!("open-vsx.org ответил {}", response.status().as_u16()));
    }
    let v: Value = response.json().await.map_err(|e| e.to_string())?;
    let list = v["extensions"].as_array().cloned().unwrap_or_default();
    Ok(list
        .into_iter()
        .map(|e| {
            json!({
                "namespace": e["namespace"],
                "name": e["name"],
                "displayName": e["displayName"].as_str().unwrap_or_else(|| e["name"].as_str().unwrap_or("")),
                "description": e["description"],
                "version": e["version"],
                "downloads": e["downloadCount"],
                "icon": e["files"]["icon"],
            })
        })
        .collect())
}

/// Скачать и установить расширение. Ошибка, если в нём нет ни тем, ни сниппетов.
#[tauri::command]
pub async fn ext_install(namespace: String, name: String) -> Result<Installed, String> {
    if !safe_part(&namespace) || !safe_part(&name) {
        return Err("некорректное имя расширения".into());
    }
    let http = client()?;
    let meta: Value = http
        .get(format!("{API}/{namespace}/{name}"))
        .send()
        .await
        .map_err(net_error)?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let url = meta["files"]["download"].as_str().ok_or("у расширения нет файла для загрузки")?;
    if !url.starts_with("https://") {
        return Err("небезопасный адрес загрузки".into());
    }
    let response = http.get(url).send().await.map_err(net_error)?;
    if !response.status().is_success() {
        return Err(format!("не удалось скачать: {}", response.status().as_u16()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("загрузка прервалась: {e}"))?;
    if bytes.len() > MAX_VSIX {
        return Err("расширение слишком большое".into());
    }
    let zip = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).map_err(|e| format!("архив повреждён: {e}"))?;
    let mut vsix = Vsix { zip };
    let manifest = vsix.json("extension/package.json").ok_or("в архиве нет package.json")?;
    let contributes = &manifest["contributes"];

    let id = format!("{namespace}.{name}");
    let dir = root()?.join(&id);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut themes = Vec::new();
    for (i, t) in contributes["themes"].as_array().cloned().unwrap_or_default().iter().enumerate() {
        let Some(path) = t["path"].as_str() else { continue };
        let Some(theme) = vsix.theme(&zip_path("extension", path), 0) else { continue };
        let file = format!("theme-{i}.json");
        std::fs::write(dir.join(&file), theme.to_string()).map_err(|e| e.to_string())?;
        let label = t["label"]
            .as_str()
            .or_else(|| theme["name"].as_str())
            .or_else(|| t["id"].as_str())
            .unwrap_or(&name)
            .to_string();
        themes.push(ThemeEntry { label, ui_theme: t["uiTheme"].as_str().unwrap_or("vs-dark").to_string(), file });
    }

    let mut snippets = Vec::new();
    for (i, s) in contributes["snippets"].as_array().cloned().unwrap_or_default().iter().enumerate() {
        let (Some(path), Some(language)) = (s["path"].as_str(), s["language"].as_str()) else { continue };
        let Some(body) = vsix.json(&zip_path("extension", path)) else { continue };
        if !body.is_object() {
            continue;
        }
        let file = format!("snippets-{i}.json");
        std::fs::write(dir.join(&file), body.to_string()).map_err(|e| e.to_string())?;
        snippets.push(SnippetEntry { language: language.to_string(), file });
    }

    if themes.is_empty() && snippets.is_empty() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err("в этом расширении нет тем и сниппетов — остальные расширения VS Code в Tulpar не работают".into());
    }

    let installed = Installed {
        id: id.clone(),
        display_name: manifest["displayName"].as_str().unwrap_or(&name).to_string(),
        version: manifest["version"].as_str().unwrap_or("").to_string(),
        description: manifest["description"].as_str().unwrap_or("").to_string(),
        themes,
        snippets,
    };
    let mut list = read_index();
    list.retain(|e| e.id != id);
    list.push(installed.clone());
    write_index(&list)?;
    Ok(installed)
}

#[tauri::command]
pub async fn ext_list() -> Result<Vec<Installed>, String> {
    Ok(read_index())
}

/// Содержимое файла установленного расширения (тема или сниппеты) — JSON-строка.
#[tauri::command]
pub async fn ext_read(id: String, file: String) -> Result<String, String> {
    if !safe_part(&id) || !safe_part(&file) {
        return Err("некорректный путь".into());
    }
    std::fs::read_to_string(root()?.join(id).join(file)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ext_uninstall(id: String) -> Result<(), String> {
    if !safe_part(&id) {
        return Err("некорректное имя".into());
    }
    let _ = std::fs::remove_dir_all(root()?.join(&id));
    let mut list = read_index();
    list.retain(|e| e.id != id);
    write_index(&list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonc() {
        let src = "{\n // c\n \"a\": \"x//y\", /* b */ \"b\": [1,2,],\n}";
        let v: Value = serde_json::from_str(&strip_jsonc(src)).unwrap();
        assert_eq!(v["a"], "x//y");
        assert_eq!(v["b"], json!([1, 2]));
    }

    #[test]
    fn paths() {
        assert_eq!(zip_path("extension", "./themes/dark.json"), "extension/themes/dark.json");
        assert_eq!(zip_path("extension/themes", "../base/a.json"), "extension/base/a.json");
        assert_eq!(zip_path("extension", "../../x.json"), "extension/x.json");
    }
}
