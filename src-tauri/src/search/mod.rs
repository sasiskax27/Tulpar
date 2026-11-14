//! Поиск и замена по всему проекту. Учитывает .gitignore, пропускает двоичные
//! и слишком большие файлы. Работает в отдельном потоке, чтобы не тормозить окно.

use std::path::Path;

use ignore::overrides::OverrideBuilder;
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::workspace::{atomic_write, current_root, resolve, to_string, WorkspaceState};

const MAX_MATCHES: usize = 10_000;
const MAX_PER_FILE: usize = 500;
const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024;
const PREVIEW_BEFORE: usize = 40;
const PREVIEW_AFTER: usize = 140;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
    /// Через запятую: «*.rs, src/**». Пусто — все файлы.
    #[serde(default)]
    include: String,
    /// Через запятую: «node_modules, *.min.js».
    #[serde(default)]
    exclude: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// Номер строки с 1
    line: usize,
    /// Столбцы в единицах UTF-16 с 1 — как в Monaco
    start_col: usize,
    end_col: usize,
    before: String,
    text: String,
    after: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    path: String,
    rel: String,
    matches: Vec<Match>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    files: Vec<FileMatches>,
    total: usize,
    truncated: bool,
}

fn build_regex(opts: &SearchOptions) -> Result<Regex, String> {
    let body = if opts.regex { opts.query.clone() } else { regex::escape(&opts.query) };
    let pattern = if opts.whole_word { format!(r"\b(?:{body})\b") } else { body };
    RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| format!("ошибка в регулярном выражении: {e}"))
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Не больше n символов с конца строки
fn tail(s: &str, n: usize) -> String {
    let count = s.chars().count();
    let text: String = s.chars().skip(count.saturating_sub(n)).collect();
    if count > n { format!("…{text}") } else { text }
}

fn head(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn read_text(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > MAX_FILE_SIZE {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn split_globs(list: &str) -> impl Iterator<Item = &str> {
    list.split(',').map(str::trim).filter(|g| !g.is_empty())
}

fn search_blocking(root: &Path, opts: &SearchOptions) -> Result<SearchResult, String> {
    let re = build_regex(opts)?;
    let mut overrides = OverrideBuilder::new(root);
    for glob in split_globs(&opts.include) {
        overrides.add(glob).map_err(|e| format!("шаблон «{glob}»: {e}"))?;
    }
    for glob in split_globs(&opts.exclude) {
        overrides.add(&format!("!{glob}")).map_err(|e| format!("шаблон «{glob}»: {e}"))?;
    }
    let overrides = overrides.build().map_err(|e| e.to_string())?;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .overrides(overrides)
        .filter_entry(|e| e.file_name() != ".git")
        .build();

    let mut files = Vec::new();
    let mut total = 0;
    let mut truncated = false;
    'walk: for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Some(text) = read_text(entry.path()) else { continue };
        let mut matches = Vec::new();
        for (index, line) in text.lines().enumerate() {
            for m in re.find_iter(line) {
                if m.start() == m.end() {
                    continue; // пустое совпадение (например, «^») ничего не даёт
                }
                let start_col = utf16_len(&line[..m.start()]) + 1;
                matches.push(Match {
                    line: index + 1,
                    start_col,
                    end_col: start_col + utf16_len(m.as_str()),
                    before: tail(line[..m.start()].trim_start(), PREVIEW_BEFORE),
                    text: head(m.as_str(), 200),
                    after: head(&line[m.end()..], PREVIEW_AFTER),
                });
                total += 1;
                if total >= MAX_MATCHES {
                    truncated = true;
                    break;
                }
                if matches.len() >= MAX_PER_FILE {
                    break;
                }
            }
            if total >= MAX_MATCHES || matches.len() >= MAX_PER_FILE {
                break;
            }
        }
        if !matches.is_empty() {
            let rel = entry
                .path()
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            files.push(FileMatches { path: to_string(entry.path()), rel, matches });
        }
        if truncated {
            break 'walk;
        }
    }
    files.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(SearchResult { files, total, truncated })
}

/// Найти текст во всех файлах проекта.
#[tauri::command]
pub async fn search_project(state: State<'_, WorkspaceState>, options: SearchOptions) -> Result<SearchResult, String> {
    if options.query.is_empty() {
        return Ok(SearchResult { files: Vec::new(), total: 0, truncated: false });
    }
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || search_blocking(&root, &options))
        .await
        .map_err(|e| e.to_string())?
}

/// Заменить все совпадения в одном файле на диске. Возвращает число замен.
/// Файлы, открытые во вкладках, интерфейс меняет сам — в редакторе, с отменой.
#[tauri::command]
pub async fn replace_in_file(
    state: State<'_, WorkspaceState>,
    path: String,
    options: SearchOptions,
    replacement: String,
) -> Result<usize, String> {
    let file = resolve(&state, &path)?;
    let re = build_regex(&options)?;
    let text = read_text(&file).ok_or("файл не текстовый или слишком большой")?;
    let count = text.lines().map(|l| re.find_iter(l).filter(|m| m.start() != m.end()).count()).sum();
    if count == 0 {
        return Ok(0);
    }
    // Заменяем построчно, чтобы «^» и «$» значили то же, что при поиске
    let mut out = String::with_capacity(text.len());
    for piece in text.split_inclusive('\n') {
        let (line, ending) = match piece.strip_suffix("\r\n") {
            Some(l) => (l, "\r\n"),
            None => match piece.strip_suffix('\n') {
                Some(l) => (l, "\n"),
                None => (piece, ""),
            },
        };
        let replaced = if options.regex {
            re.replace_all(line, replacement.as_str())
        } else {
            re.replace_all(line, NoExpand(&replacement))
        };
        out.push_str(&replaced);
        out.push_str(ending);
    }
    atomic_write(&file, out.as_bytes())?;
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(query: &str, case: bool, word: bool, regex: bool) -> SearchOptions {
        SearchOptions {
            query: query.into(),
            case_sensitive: case,
            whole_word: word,
            regex,
            include: String::new(),
            exclude: String::new(),
        }
    }

    #[test]
    fn plain_text_is_escaped() {
        let re = build_regex(&opts("a.b(", true, false, false)).unwrap();
        assert!(re.is_match("x a.b( y"));
        assert!(!re.is_match("axb("));
    }

    #[test]
    fn case_and_words() {
        assert!(build_regex(&opts("Tulpar", false, false, false)).unwrap().is_match("tulpar"));
        assert!(!build_regex(&opts("Tulpar", true, false, false)).unwrap().is_match("tulpar"));
        let word = build_regex(&opts("best", true, true, false)).unwrap();
        assert!(word.is_match("best = 0"));
        assert!(!word.is_match("bestseller"));
    }

    #[test]
    fn bad_regex_is_an_error() {
        assert!(build_regex(&opts("(", true, false, true)).is_err());
    }

    #[test]
    fn utf16_columns() {
        // «Привет 🐎 x»: эмодзи занимает 2 единицы UTF-16
        let line = "Привет 🐎 x";
        let re = build_regex(&opts("x", true, false, false)).unwrap();
        let m = re.find(line).unwrap();
        assert_eq!(utf16_len(&line[..m.start()]) + 1, 10);
    }

    #[test]
    fn search_and_replace_files() {
        let dir = std::env::temp_dir().join(format!("tulpar-search-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.py"), "best = 0\nbest_score = 1\r\nprint(best)\n").unwrap();
        std::fs::write(dir.join("b.txt"), "nothing here\n").unwrap();
        let o = opts("best", true, true, false);
        let res = search_blocking(&dir, &o).unwrap();
        assert_eq!(res.total, 2);
        assert_eq!(res.files.len(), 1);
        assert_eq!(res.files[0].rel, "src/a.py");
        assert_eq!(res.files[0].matches[1].line, 3);
        assert_eq!(res.files[0].matches[1].start_col, 7);

        let mut inc = opts("best", true, false, false);
        inc.include = "*.txt".into();
        assert_eq!(search_blocking(&dir, &inc).unwrap().total, 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
