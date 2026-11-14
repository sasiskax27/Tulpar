//! Рабочая папка: открытие проекта, чтение и запись файлов, слежение за диском.
//!
//! Все пути, которые приходят из интерфейса, проверяются: доступ разрешён
//! только внутри открытой папки.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Файлы больше этого размера пока не открываем (позже — «режим большого файла»).
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;
/// Предел для быстрого перехода к файлу (Ctrl+P).
const MAX_LISTED_FILES: usize = 50_000;

#[derive(Default)]
pub struct WorkspaceState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize, Clone)]
pub struct ChangeEvent {
    kind: &'static str,
    paths: Vec<String>,
}

pub(crate) fn to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// canonicalize без префикса «\\?\» на Windows: такие пути не понимают
/// языковые серверы и они некрасиво выглядят в интерфейсе.
pub fn canonical(p: &Path) -> std::io::Result<PathBuf> {
    let c = p.canonicalize()?;
    #[cfg(windows)]
    {
        let s = c.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") {
                return Ok(PathBuf::from(rest));
            }
        }
    }
    Ok(c)
}

pub(crate) fn current_root(state: &WorkspaceState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "внутренняя ошибка: состояние повреждено".to_string())?
        .clone()
        .ok_or_else(|| "папка не открыта".to_string())
}

/// Приводит путь к каноническому виду и проверяет, что он внутри открытой папки
/// или папки настроек Tulpar. Для ещё не существующего файла проверяется его
/// родительская папка.
pub(crate) fn resolve(state: &WorkspaceState, path: &str) -> Result<PathBuf, String> {
    let mut allowed: Vec<PathBuf> = Vec::new();
    if let Ok(root) = current_root(state) {
        allowed.push(root);
    }
    if let Some(cfg) = crate::config::dir().and_then(|d| canonical(&d).ok()) {
        allowed.push(cfg);
    }
    let p = PathBuf::from(path);
    let canonical = if p.exists() {
        canonical(&p).map_err(|e| e.to_string())?
    } else {
        let parent = p.parent().ok_or("некорректный путь")?;
        let name = p.file_name().ok_or("некорректный путь")?;
        canonical(parent).map_err(|e| e.to_string())?.join(name)
    };
    if allowed.iter().any(|a| canonical.starts_with(a)) {
        Ok(canonical)
    } else {
        Err(format!("доступ запрещён: {path} вне открытой папки"))
    }
}

fn is_inside_git_dir(p: &Path) -> bool {
    p.components().any(|c| c.as_os_str() == ".git")
}

/// Открыть папку проекта и начать следить за изменениями в ней.
#[tauri::command]
pub async fn workspace_open(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    path: String,
) -> Result<String, String> {
    let root = canonical(Path::new(&path))
        .map_err(|e| format!("не удалось открыть {path}: {e}"))?;
    if !root.is_dir() {
        return Err(format!("{path} — не папка"));
    }

    let emitter = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let kind = match event.kind {
            EventKind::Create(_) => "create",
            EventKind::Modify(_) => "modify",
            EventKind::Remove(_) => "remove",
            _ => return,
        };
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter(|p| !is_inside_git_dir(p))
            .map(|p| to_string(p))
            .collect();
        if !paths.is_empty() {
            let _ = emitter.emit("workspace:changed", ChangeEvent { kind, paths });
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *state.watcher.lock().map_err(|_| "состояние повреждено")? = Some(watcher);
    *state.root.lock().map_err(|_| "состояние повреждено")? = Some(root.clone());
    Ok(to_string(&root))
}

/// Текущая открытая папка (или null).
#[tauri::command]
pub async fn workspace_root(state: State<'_, WorkspaceState>) -> Result<Option<String>, String> {
    Ok(current_root(&state).ok().map(|p| to_string(&p)))
}

/// Содержимое одной папки: сначала папки, потом файлы, по алфавиту.
#[tauri::command]
pub async fn read_dir(state: State<'_, WorkspaceState>, path: String) -> Result<Vec<DirEntry>, String> {
    let dir = resolve(&state, &path)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(DirEntry {
            name,
            path: to_string(&entry.path()),
            is_dir,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Прочитать текстовый файл.
#[tauri::command]
pub async fn read_file(state: State<'_, WorkspaceState>, path: String) -> Result<String, String> {
    let file = resolve(&state, &path)?;
    let size = std::fs::metadata(&file).map_err(|e| e.to_string())?.len();
    if size > MAX_FILE_SIZE {
        return Err(format!("файл слишком большой ({} МБ)", size / 1024 / 1024));
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err("это двоичный файл".into());
    }
    String::from_utf8(bytes).map_err(|_| "файл не в кодировке UTF-8".into())
}

/// Записать байты атомарно: сначала во временный файл рядом, затем переименование.
/// Так при сбое на диске не останется наполовину записанный файл.
pub(crate) fn atomic_write(file: &Path, content: &[u8]) -> Result<(), String> {
    let name = file
        .file_name()
        .ok_or("некорректный путь")?
        .to_string_lossy()
        .into_owned();
    let tmp = file.with_file_name(format!(".{name}.tulpar-tmp"));
    std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Записать файл.
#[tauri::command]
pub async fn write_file(
    state: State<'_, WorkspaceState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let file = resolve(&state, &path)?;
    atomic_write(&file, content.as_bytes())
}

fn check_name(path: &Path) -> Result<(), String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.is_empty() || name == "." || name == ".." {
        return Err("некорректное имя".into());
    }
    if cfg!(windows) && name.chars().any(|c| "<>:\"|?*".contains(c)) {
        return Err("имя не может содержать < > : \" | ? *".into());
    }
    Ok(())
}

/// Создать пустой файл. Ошибка, если такой уже есть.
#[tauri::command]
pub async fn create_file(state: State<'_, WorkspaceState>, path: String) -> Result<String, String> {
    let file = resolve(&state, &path)?;
    check_name(&file)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => "файл с таким именем уже есть".to_string(),
            _ => e.to_string(),
        })?;
    Ok(to_string(&file))
}

/// Создать папку.
#[tauri::command]
pub async fn create_dir(state: State<'_, WorkspaceState>, path: String) -> Result<String, String> {
    let dir = resolve(&state, &path)?;
    check_name(&dir)?;
    if dir.exists() {
        return Err("папка или файл с таким именем уже есть".into());
    }
    std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    Ok(to_string(&dir))
}

/// Переименовать или переместить файл или папку внутри проекта.
#[tauri::command]
pub async fn rename_path(state: State<'_, WorkspaceState>, from: String, to: String) -> Result<String, String> {
    let source = resolve(&state, &from)?;
    let target = resolve(&state, &to)?;
    check_name(&target)?;
    if source == current_root(&state)? {
        return Err("нельзя переименовать саму папку проекта".into());
    }
    // На Windows и macOS «file.txt» → «File.txt» — тот же файл, это разрешаем
    let same_file = cfg!(any(windows, target_os = "macos"))
        && source.to_string_lossy().to_lowercase() == target.to_string_lossy().to_lowercase();
    if target.exists() && !same_file {
        return Err("файл или папка с таким именем уже есть".into());
    }
    std::fs::rename(&source, &target).map_err(|e| e.to_string())?;
    Ok(to_string(&target))
}

/// Удалить в корзину — чтобы случайное удаление можно было отменить.
#[tauri::command]
pub async fn delete_path(state: State<'_, WorkspaceState>, path: String) -> Result<(), String> {
    let target = resolve(&state, &path)?;
    if target == current_root(&state)? {
        return Err("нельзя удалить саму папку проекта".into());
    }
    trash::delete(&target).map_err(|e| format!("не удалось переместить в корзину: {e}"))
}

/// Все файлы проекта (с учётом .gitignore) — для быстрого перехода Ctrl+P.
/// Пути возвращаются относительно корня, с разделителем «/».
#[tauri::command]
pub async fn list_files(state: State<'_, WorkspaceState>) -> Result<Vec<String>, String> {
    let root = current_root(&state)?;
    let walker = ignore::WalkBuilder::new(&root)
        .hidden(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build();
    let mut files = Vec::new();
    for entry in walker.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Ok(rel) = entry.path().strip_prefix(&root) {
                files.push(rel.to_string_lossy().replace('\\', "/"));
            }
            if files.len() >= MAX_LISTED_FILES {
                break;
            }
        }
    }
    files.sort();
    Ok(files)
}
