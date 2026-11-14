//! Git через командную строку `git`, установленную у пользователя.
//! Так работают все его настройки: имя и почта, ключи, менеджер паролей
//! (на Windows Git Credential Manager сам покажет окно входа), хуки.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;

use crate::workspace::{current_root, resolve, WorkspaceState};

/// Предел для текста изменений, который уходит ИИ на сообщение коммита
const MAX_DIFF_FOR_AI: usize = 24_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Путь от корня репозитория, через «/»
    path: String,
    /// Полный путь на диске
    abs: String,
    /// Буква статуса в индексе (подготовлено): M A D R C или пробел
    index: String,
    /// Буква статуса в рабочей папке: M D ? или пробел
    work: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    is_repo: bool,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<GitFile>,
}

fn git(root: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(root)
        // Никаких вопросов в невидимой консоли — иначе процесс зависнет
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Выполнить git и вернуть вывод; при ошибке — текст ошибки git.
fn run(root: &Path, args: &[&str]) -> Result<String, String> {
    let out = git(root, args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "git не найден. Установите Git: winget install Git.Git".to_string()
        } else {
            e.to_string()
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        let msg = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_owned() } else { err };
        Err(msg)
    }
}

async fn run_async(root: PathBuf, args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run(&root, &refs)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Разбор `git status --porcelain=v1 -b -z`.
fn parse_status(root: &Path, out: &str) -> GitStatus {
    let mut status = GitStatus { is_repo: true, branch: None, upstream: None, ahead: 0, behind: 0, files: Vec::new() };
    let mut parts = out.split('\0').filter(|p| !p.is_empty());
    while let Some(entry) = parts.next() {
        if let Some(head) = entry.strip_prefix("## ") {
            // «main...origin/main [ahead 1, behind 2]» или «No commits yet on main»
            let (names, counts) = match head.find(" [") {
                Some(i) => (&head[..i], &head[i + 2..head.len().saturating_sub(1)]),
                None => (head, ""),
            };
            let names = names.trim_start_matches("No commits yet on ").trim_start_matches("Initial commit on ");
            let mut split = names.splitn(2, "...");
            let branch = split.next().unwrap_or_default();
            status.branch = if branch.starts_with("HEAD (no branch)") { None } else { Some(branch.to_owned()) };
            status.upstream = split.next().map(str::to_owned);
            for c in counts.split(", ") {
                if let Some(n) = c.strip_prefix("ahead ") {
                    status.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = c.strip_prefix("behind ") {
                    status.behind = n.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if entry.len() < 4 {
            continue;
        }
        let index = &entry[0..1];
        let work = &entry[1..2];
        let path = entry[3..].to_owned();
        // У переименования следом идёт старое имя — оно нам не нужно
        if index == "R" || index == "C" {
            parts.next();
        }
        let abs = root.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
        status.files.push(GitFile {
            abs: abs.to_string_lossy().into_owned(),
            path,
            index: index.to_owned(),
            work: work.to_owned(),
        });
    }
    status
}

fn rel_paths(root: &Path, state: &WorkspaceState, paths: &[String]) -> Result<Vec<String>, String> {
    paths
        .iter()
        .map(|p| {
            let abs = resolve(state, p).or_else(|_| {
                // Удалённый файл resolve не найдёт — проверяем по папке
                let path = PathBuf::from(p);
                if path.starts_with(root) { Ok(path) } else { Err(format!("доступ запрещён: {p}")) }
            })?;
            Ok(abs.strip_prefix(root).unwrap_or(&abs).to_string_lossy().replace('\\', "/"))
        })
        .collect()
}

#[tauri::command]
pub async fn git_status(state: State<'_, WorkspaceState>) -> Result<GitStatus, String> {
    let root = current_root(&state)?;
    let r = root.clone();
    let out = tauri::async_runtime::spawn_blocking(move || run(&r, &["status", "--porcelain=v1", "-b", "-z", "-uall"]))
        .await
        .map_err(|e| e.to_string())?;
    match out {
        Ok(text) => Ok(parse_status(&root, &text)),
        Err(e) if e.contains("not a git repository") => {
            Ok(GitStatus { is_repo: false, branch: None, upstream: None, ahead: 0, behind: 0, files: Vec::new() })
        }
        Err(e) => Err(e),
    }
}

/// Содержимое файла в последнем коммите (для разницы и меток на полях).
/// Пустая строка — файла в коммите нет (новый).
#[tauri::command]
pub async fn git_show_head(state: State<'_, WorkspaceState>, path: String) -> Result<String, String> {
    let root = current_root(&state)?;
    let rel = rel_paths(&root, &state, &[path])?.remove(0);
    match run_async(root, vec!["show".into(), format!("HEAD:{rel}")]).await {
        Ok(text) => Ok(text),
        Err(e) if e.contains("does not exist") || e.contains("exists on disk") || e.contains("invalid object")
            || e.contains("bad revision") || e.contains("unknown revision") => Ok(String::new()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn git_stage(state: State<'_, WorkspaceState>, paths: Vec<String>) -> Result<(), String> {
    let root = current_root(&state)?;
    let mut args = vec!["add".to_string(), "-A".into(), "--".into()];
    args.extend(rel_paths(&root, &state, &paths)?);
    run_async(root, args).await.map(|_| ())
}

#[tauri::command]
pub async fn git_unstage(state: State<'_, WorkspaceState>, paths: Vec<String>) -> Result<(), String> {
    let root = current_root(&state)?;
    let rels = rel_paths(&root, &state, &paths)?;
    // В репозитории без коммитов «restore --staged» не работает — там «rm --cached»
    let has_head = run_async(root.clone(), vec!["rev-parse".into(), "--verify".into(), "HEAD".into()]).await.is_ok();
    let mut args: Vec<String> = if has_head {
        vec!["restore".into(), "--staged".into(), "--".into()]
    } else {
        vec!["rm".into(), "--cached".into(), "-r".into(), "-q".into(), "--".into()]
    };
    args.extend(rels);
    run_async(root, args).await.map(|_| ())
}

/// Откатить изменения в рабочей папке. Новые (неотслеживаемые) файлы уходят в корзину.
#[tauri::command]
pub async fn git_discard(state: State<'_, WorkspaceState>, paths: Vec<String>) -> Result<(), String> {
    let root = current_root(&state)?;
    let status = parse_status(&root, &run_async(root.clone(), vec!["status".into(), "--porcelain=v1".into(), "-z".into(), "-uall".into()]).await?);
    let rels = rel_paths(&root, &state, &paths)?;
    let mut tracked = Vec::new();
    for rel in rels {
        let untracked = status.files.iter().any(|f| f.path == rel && f.work == "?");
        if untracked {
            trash::delete(root.join(&rel)).map_err(|e| format!("не удалось удалить {rel}: {e}"))?;
        } else {
            tracked.push(rel);
        }
    }
    if !tracked.is_empty() {
        let mut args = vec!["checkout".to_string(), "--".into()];
        args.extend(tracked);
        run_async(root, args).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_commit(state: State<'_, WorkspaceState>, message: String, all: bool) -> Result<(), String> {
    let root = current_root(&state)?;
    if message.trim().is_empty() {
        return Err("напишите сообщение коммита".into());
    }
    if all {
        run_async(root.clone(), vec!["add".into(), "-A".into()]).await?;
    }
    run_async(root, vec!["commit".into(), "-m".into(), message]).await.map(|_| ())
}

#[tauri::command]
pub async fn git_init(state: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = current_root(&state)?;
    run_async(root, vec!["init".into()]).await.map(|_| ())
}

#[tauri::command]
pub async fn git_branches(state: State<'_, WorkspaceState>) -> Result<Vec<String>, String> {
    let root = current_root(&state)?;
    let out = run_async(root, vec!["branch".into(), "--format=%(refname:short)".into()]).await?;
    Ok(out.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect())
}

#[tauri::command]
pub async fn git_checkout(state: State<'_, WorkspaceState>, branch: String, create: bool) -> Result<(), String> {
    let root = current_root(&state)?;
    if branch.starts_with('-') || branch.trim().is_empty() {
        return Err("некорректное имя ветки".into());
    }
    let args = if create {
        vec!["switch".into(), "-c".into(), branch]
    } else {
        vec!["switch".into(), branch]
    };
    run_async(root, args).await.map(|_| ())
}

/// push / pull / fetch. Если у ветки нет удалённой пары, push создаёт её.
#[tauri::command]
pub async fn git_sync(state: State<'_, WorkspaceState>, action: String) -> Result<String, String> {
    let root = current_root(&state)?;
    let args: Vec<String> = match action.as_str() {
        "push" => {
            let has_upstream = run_async(root.clone(), vec!["rev-parse".into(), "--abbrev-ref".into(), "@{u}".into()]).await.is_ok();
            if has_upstream {
                vec!["push".into()]
            } else {
                vec!["push".into(), "-u".into(), "origin".into(), "HEAD".into()]
            }
        }
        "pull" => vec!["pull".into(), "--no-rebase".into()],
        "fetch" => vec!["fetch".into(), "--prune".into()],
        _ => return Err("неизвестное действие".into()),
    };
    run_async(root, args).await
}

/// Изменения текстом — для сообщения коммита от ИИ. Подготовленные, а если
/// таких нет — все. Плюс список новых файлов, которых нет в diff.
#[tauri::command]
pub async fn git_diff_for_message(state: State<'_, WorkspaceState>) -> Result<String, String> {
    let root = current_root(&state)?;
    let staged = run_async(root.clone(), vec!["diff".into(), "--cached".into(), "--stat".into(), "-p".into()]).await?;
    let mut text = if staged.trim().is_empty() {
        let mut all = run_async(root.clone(), vec!["diff".into(), "--stat".into(), "-p".into()]).await?;
        let untracked = run_async(root, vec!["ls-files".into(), "--others".into(), "--exclude-standard".into()]).await?;
        if !untracked.trim().is_empty() {
            all.push_str("\nНовые файлы:\n");
            all.push_str(&untracked);
        }
        all
    } else {
        staged
    };
    if text.len() > MAX_DIFF_FOR_AI {
        let mut cut = MAX_DIFF_FOR_AI;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("\n…(изменения обрезаны)");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_files() {
        let root = Path::new("/p");
        let out = "## main...origin/main [ahead 2, behind 1]\0 M src/a.rs\0A  new.txt\0R  b.rs\0old.rs\0?? x y.py\0";
        let s = parse_status(root, out);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        let names: Vec<_> = s.files.iter().map(|f| (f.index.as_str(), f.work.as_str(), f.path.as_str())).collect();
        assert_eq!(names, vec![(" ", "M", "src/a.rs"), ("A", " ", "new.txt"), ("R", " ", "b.rs"), ("?", "?", "x y.py")]);
    }

    #[test]
    fn parses_new_repo() {
        let s = parse_status(Path::new("/p"), "## No commits yet on main\0?? a.txt\0");
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream, None);
        assert_eq!(s.files.len(), 1);
    }
}
