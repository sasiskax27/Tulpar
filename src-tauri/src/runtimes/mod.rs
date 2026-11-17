//! Языки «в один клик»: портативные Python, Node.js, Go, Java, uv скачиваются
//! с официальных источников (GitHub-релизы, nodejs.org, go.dev, Adoptium) в
//! папку Tulpar — без прав администратора и без установщиков. Папки с
//! программами добавляются в PATH самого Tulpar, поэтому их видят терминал,
//! агент, языковые серверы и запуск кода.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "nodejs.org",
    "go.dev",
    "dl.google.com",
    "api.adoptium.net",
    "nginx.org",
    "get.enterprisedb.com",
    "sbp.enterprisedb.com",
    "dev.mysql.com",
    "cdn.mysql.com",
    "downloads.mysql.com",
    "www.sqlite.org",
    "windows.php.net",
    "downloads.php.net",
    "fastdl.mongodb.org",
    "dl.deno.land",
    "services.gradle.org",
    "storage.googleapis.com",
];

fn root() -> Result<PathBuf, String> {
    let dir = crate::config::dir().ok_or("не удалось определить папку настроек")?.join("runtimes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_kind(kind: &str) -> bool {
    !kind.is_empty() && kind.len() < 24 && kind.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Все папки с программами из установленных языков.
fn bin_dirs() -> Vec<PathBuf> {
    let Ok(root) = root() else { return vec![] };
    let mut out = vec![];
    let Ok(entries) = fs::read_dir(&root) else { return out };
    for e in entries.flatten() {
        let dir = e.path();
        if let Ok(list) = fs::read_to_string(dir.join(".bins")) {
            for rel in list.lines().map(str::trim) {
                let p = if rel.is_empty() || rel == "." { dir.clone() } else { dir.join(rel) };
                if p.is_dir() {
                    out.push(p);
                }
            }
        }
    }
    out
}

/// Добавить папки языков в PATH процесса Tulpar (наследуют все дочерние процессы).
pub fn apply_path() {
    let dirs = bin_dirs();
    let current = std::env::var_os("PATH").unwrap_or_default();
    let existing: Vec<PathBuf> = std::env::split_paths(&current).collect();
    let mut all: Vec<PathBuf> = dirs.into_iter().filter(|d| !existing.contains(d)).collect();
    if all.is_empty() {
        return;
    }
    all.extend(existing);
    if let Ok(joined) = std::env::join_paths(all) {
        std::env::set_var("PATH", joined);
    }
}

#[derive(Serialize)]
pub struct Installed {
    kind: String,
    dir: String,
    version: String,
}

#[tauri::command]
pub fn runtimes_list() -> Result<Vec<Installed>, String> {
    let root = root()?;
    let mut out = vec![];
    for e in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let dir = e.path();
        if dir.join(".bins").exists() {
            out.push(Installed {
                kind: e.file_name().to_string_lossy().into_owned(),
                dir: dir.to_string_lossy().into_owned(),
                version: fs::read_to_string(dir.join(".version")).unwrap_or_default().trim().to_string(),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn runtime_remove(kind: String) -> Result<(), String> {
    if !valid_kind(&kind) {
        return Err("неизвестный язык".into());
    }
    let dir = root()?.join(&kind);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("не удалось удалить (возможно, программа сейчас запущена): {e}"))?;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
struct Progress {
    kind: String,
    done: u64,
    total: u64,
    stage: &'static str,
}

fn host_allowed(url: &str) -> bool {
    url.strip_prefix("https://")
        .and_then(|rest| rest.split(['/', '?']).next())
        .map(|host| ALLOWED_HOSTS.contains(&host))
        .unwrap_or(false)
}

/// Если в папке ровно одна подпапка (node-v22…/, jdk-21…/, python/) — поднять её содержимое.
fn flatten_single_dir(dir: &Path) -> Result<(), String> {
    let entries: Vec<_> = fs::read_dir(dir).map_err(|e| e.to_string())?.flatten().collect();
    if entries.len() != 1 || !entries[0].path().is_dir() {
        return Ok(());
    }
    let inner = entries[0].path();
    let tmp = dir.with_extension("flatten-tmp");
    let _ = fs::remove_dir_all(&tmp);
    fs::rename(&inner, &tmp).map_err(|e| e.to_string())?;
    for e in fs::read_dir(&tmp).map_err(|e| e.to_string())?.flatten() {
        fs::rename(e.path(), dir.join(e.file_name())).map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_dir_all(&tmp);
    Ok(())
}

fn safe_join(base: &Path, rel: &Path) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for c in rel.components() {
        match c {
            std::path::Component::Normal(p) => out.push(p),
            std::path::Component::CurDir => {}
            _ => return None, // ../, абсолютные пути — не пускаем
        }
    }
    Some(out)
}

fn extract(archive: &Path, dest: &Path) -> Result<(), String> {
    let mut magic = [0u8; 2];
    fs::File::open(archive).and_then(|mut f| f.read_exact(&mut magic)).map_err(|e| e.to_string())?;
    if &magic == b"PK" {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let Some(rel) = entry.enclosed_name() else { continue };
            let Some(out) = safe_join(dest, &rel) else { continue };
            if entry.is_dir() {
                fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = out.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut f = fs::File::create(&out).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut f).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                if let Some(mode) = entry.unix_mode() {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
                }
            }
        }
        Ok(())
    } else if magic == [0x1f, 0x8b] {
        let file = fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let rel = entry.path().map_err(|e| e.to_string())?.into_owned();
            let Some(out) = safe_join(dest, &rel) else { continue };
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            entry.unpack(&out).map_err(|e| e.to_string())?;
        }
        Ok(())
    } else {
        Err("неизвестный формат архива".into())
    }
}

/// Скачать архив языка и распаковать в папку Tulpar.
#[tauri::command]
pub async fn runtime_install(app: AppHandle, kind: String, url: String, bins: Vec<String>, version: String) -> Result<String, String> {
    if !valid_kind(&kind) {
        return Err("неизвестный язык".into());
    }
    if !host_allowed(&url) {
        return Err("скачивание разрешено только с официальных сайтов языков".into());
    }
    let root = root()?;
    let dest = root.join(&kind);
    let archive = root.join(format!("{kind}.download"));

    let client = reqwest::Client::builder()
        .user_agent("Tulpar")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| format!("не удалось скачать: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("сервер ответил {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(&archive).map_err(|e| e.to_string())?;
    let mut done = 0u64;
    let mut last = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("загрузка прервалась: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        if done - last > 512 * 1024 {
            last = done;
            let _ = app.emit("runtime-progress", Progress { kind: kind.clone(), done, total, stage: "download" });
        }
    }
    drop(file);
    let _ = app.emit("runtime-progress", Progress { kind: kind.clone(), done, total, stage: "extract" });

    let (archive2, dest2) = (archive.clone(), dest.clone());
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let tmp = dest2.with_extension("new");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        extract(&archive2, &tmp)?;
        flatten_single_dir(&tmp)?;
        if dest2.exists() {
            fs::remove_dir_all(&dest2).map_err(|e| format!("старая версия занята — закройте программы, которые её используют: {e}"))?;
        }
        fs::rename(&tmp, &dest2).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = fs::remove_file(&archive);
    fs::write(dest.join(".bins"), bins.join("\n")).map_err(|e| e.to_string())?;
    fs::write(dest.join(".version"), version).map_err(|e| e.to_string())?;
    apply_path();
    let _ = app.emit("runtime-progress", Progress { kind: kind.clone(), done, total, stage: "done" });
    Ok(dest.to_string_lossy().into_owned())
}

/// Полная версия Tulpar везёт Java и Gradle в установщике (папка toolchain рядом
/// с программой). При первом запуске распаковываем их в runtimes — как будто
/// поставили из магазина, только без интернета. Android SDK так возить нельзя
/// (лицензия Google запрещает распространять его) — он скачивается при первой сборке.
pub fn install_bundled(resource_dir: Option<PathBuf>) {
    let Some(dir) = resource_dir.map(|d| d.join("toolchain")) else { return };
    let Ok(base) = root() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };
    let mut changed = false;
    for e in entries.flatten() {
        let path = e.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_owned();
        // Имя архива: <kind>@<version>@<bins через запятую>.zip|.tar.gz, например java@21@bin.zip
        // (в папках «/» заменён на «+»: Contents+Home+bin)
        let Some(stem) = name.strip_suffix(".zip").or_else(|| name.strip_suffix(".tar.gz")) else { continue };
        let parts: Vec<&str> = stem.split('@').collect();
        if parts.len() != 3 || !valid_kind(parts[0]) {
            continue;
        }
        let dest = base.join(parts[0]);
        if dest.join(".version").exists() {
            continue;
        }
        let tmp = dest.with_extension("new");
        let _ = fs::remove_dir_all(&tmp);
        if fs::create_dir_all(&tmp).is_err() || extract(&path, &tmp).is_err() || flatten_single_dir(&tmp).is_err() {
            let _ = fs::remove_dir_all(&tmp);
            continue;
        }
        let _ = fs::remove_dir_all(&dest);
        if fs::rename(&tmp, &dest).is_err() {
            continue;
        }
        let _ = fs::write(dest.join(".bins"), parts[2].replace(',', "\n").replace('+', "/"));
        let _ = fs::write(dest.join(".version"), parts[1]);
        changed = true;
    }
    if changed {
        apply_path();
    }
}
