//! Копирование и перемещение файлов и папок: перетаскивание внутри дерева
//! и из проводника системы в Tulpar.
//!
//! Цель всегда внутри открытой папки. Источник — внутри неё же, либо файл,
//! который пользователь только что сам перетащил в окно (ядро запоминает пути
//! из события перетаскивания, поэтому интерфейс не может «взять» что угодно с диска).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::State;

use crate::workspace::{canonical, current_root, resolve, to_string, WorkspaceState};

/// Пути, брошенные в окно последним перетаскиванием из системы.
#[derive(Default)]
pub struct DroppedPaths(pub Mutex<Vec<PathBuf>>);

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Copy,
    Move,
}

/// «name.ext» → «name (2).ext», «name (3).ext»… — первое свободное имя в папке.
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("бесконечный перебор имён")
}

/// Рекурсивное копирование. Символические ссылки пропускаем, чтобы не уйти в цикл.
fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        std::fs::create_dir(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(from, to)?;
    }
    Ok(())
}

fn remove_recursive(path: &Path) -> std::io::Result<()> {
    if std::fs::symlink_metadata(path)?.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// Перенести один путь. rename — мгновенно на том же диске; между дисками
/// rename не работает, тогда копируем и удаляем исходник.
fn transfer_one(source: &Path, target_dir: &Path, mode: Mode) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .ok_or("некорректный путь")?
        .to_string_lossy()
        .into_owned();
    if source.is_dir() && target_dir.starts_with(source) {
        return Err(format!("нельзя поместить папку «{name}» внутрь самой себя"));
    }
    if mode == Mode::Move && source.parent() == Some(target_dir) {
        return Ok(source.to_path_buf()); // уже здесь
    }
    let dest = free_name(target_dir, &name);
    match mode {
        Mode::Copy => {
            copy_recursive(source, &dest).map_err(|e| format!("не удалось скопировать «{name}»: {e}"))?;
        }
        Mode::Move => {
            if std::fs::rename(source, &dest).is_err() {
                copy_recursive(source, &dest).map_err(|e| {
                    let _ = remove_recursive(&dest);
                    format!("не удалось переместить «{name}»: {e}")
                })?;
                remove_recursive(source)
                    .map_err(|e| format!("«{name}» скопирован, но исходник не удалился: {e}"))?;
            }
        }
    }
    Ok(dest)
}

/// Скопировать или переместить файлы и папки в папку проекта.
/// Возвращает новые пути в том же порядке.
#[tauri::command]
pub async fn transfer_paths(
    state: State<'_, WorkspaceState>,
    dropped: State<'_, DroppedPaths>,
    sources: Vec<String>,
    target_dir: String,
    mode: Mode,
) -> Result<Vec<String>, String> {
    let target = resolve(&state, &target_dir)?;
    if !target.is_dir() {
        return Err("перетаскивать можно только в папку".into());
    }
    let root = current_root(&state)?;
    let allowed_outside: Vec<PathBuf> = dropped
        .0
        .lock()
        .map_err(|_| "состояние повреждено")?
        .iter()
        .filter_map(|p| canonical(p).ok())
        .collect();

    let mut sources_checked = Vec::new();
    for s in &sources {
        let path = canonical(Path::new(s)).map_err(|e| format!("{s}: {e}"))?;
        if path == root {
            return Err("нельзя перенести саму папку проекта".into());
        }
        if !path.starts_with(&root) && !allowed_outside.contains(&path) {
            return Err(format!("доступ запрещён: {s}"));
        }
        sources_checked.push(path);
    }

    let mut results = Vec::new();
    for source in sources_checked {
        let dest = transfer_one(&source, &target, mode)?;
        results.push(to_string(&dest));
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tulpar-transfer-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn free_names() {
        let dir = temp("names");
        assert_eq!(free_name(&dir, "a.txt"), dir.join("a.txt"));
        std::fs::write(dir.join("a.txt"), "").unwrap();
        std::fs::write(dir.join("a (2).txt"), "").unwrap();
        assert_eq!(free_name(&dir, "a.txt"), dir.join("a (3).txt"));
        std::fs::create_dir(dir.join("src")).unwrap();
        assert_eq!(free_name(&dir, "src"), dir.join("src (2)"));
        assert_eq!(free_name(&dir, ".gitignore"), dir.join(".gitignore"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_and_move_folders() {
        let dir = temp("copy");
        std::fs::create_dir_all(dir.join("src/inner")).unwrap();
        std::fs::write(dir.join("src/inner/x.py"), "print(1)").unwrap();
        std::fs::create_dir(dir.join("dest")).unwrap();

        let copied = transfer_one(&dir.join("src"), &dir.join("dest"), Mode::Copy).unwrap();
        assert_eq!(std::fs::read_to_string(copied.join("inner/x.py")).unwrap(), "print(1)");
        assert!(dir.join("src/inner/x.py").exists());

        let again = transfer_one(&dir.join("src"), &dir.join("dest"), Mode::Copy).unwrap();
        assert_eq!(again, dir.join("dest/src (2)"));

        let moved = transfer_one(&dir.join("src"), &dir.join("dest/src"), Mode::Move).unwrap();
        assert_eq!(moved, dir.join("dest/src/src"));
        assert!(!dir.join("src").exists());

        assert!(transfer_one(&dir.join("dest"), &dir.join("dest/src"), Mode::Move).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
