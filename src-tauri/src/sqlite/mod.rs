//! Просмотр баз SQLite: список таблиц, данные, произвольные SQL-запросы.
//! По умолчанию база открывается только для чтения; изменения — только
//! если пользователь явно включил «Разрешить изменения».

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::State;

use crate::workspace::{resolve, WorkspaceState};

const MAX_ROWS: usize = 1000;
const MAX_CELL: usize = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    name: String,
    kind: String,
    rows: Option<i64>,
    columns: Vec<ColumnInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    pk: bool,
    not_null: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<serde_json::Value>>,
    truncated: bool,
    changes: Option<usize>,
    millis: u64,
}

fn open(state: &WorkspaceState, path: &str, write: bool) -> Result<Connection, String> {
    let file = resolve(state, path)?;
    let flags = if write {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX
    };
    let conn = Connection::open_with_flags(&file, flags).map_err(|e| format!("не удалось открыть базу: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(3)).ok();
    Ok(conn)
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[tauri::command]
pub async fn sqlite_tables(state: State<'_, WorkspaceState>, path: String) -> Result<Vec<TableInfo>, String> {
    let conn = open(&state, &path, false)?;
    let mut stmt = conn
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
        .map_err(|e| format!("это не база SQLite или она повреждена: {e}"))?;
    let names: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    let mut out = Vec::new();
    for (name, kind) in names {
        let mut columns = Vec::new();
        if let Ok(mut s) = conn.prepare(&format!("PRAGMA table_info({})", quote_ident(&name))) {
            let rows = s.query_map([], |r| {
                Ok(ColumnInfo {
                    name: r.get::<_, String>(1)?,
                    kind: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    not_null: r.get::<_, i64>(3)? != 0,
                    pk: r.get::<_, i64>(5)? != 0,
                })
            });
            if let Ok(rows) = rows {
                columns = rows.filter_map(Result::ok).collect();
            }
        }
        let rows = conn
            .query_row(&format!("SELECT COUNT(*) FROM {}", quote_ident(&name)), [], |r| r.get::<_, i64>(0))
            .ok();
        out.push(TableInfo { name, kind, rows, columns });
    }
    Ok(out)
}

fn cell(v: ValueRef) -> serde_json::Value {
    match v {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(i) => serde_json::json!(i),
        ValueRef::Real(f) => serde_json::json!(f),
        ValueRef::Text(t) => {
            let s = String::from_utf8_lossy(t);
            if s.chars().count() > MAX_CELL {
                serde_json::json!(format!("{}…", s.chars().take(MAX_CELL).collect::<String>()))
            } else {
                serde_json::json!(s)
            }
        }
        ValueRef::Blob(b) => serde_json::json!(format!("<двоичные данные, {} байт>", b.len())),
    }
}

/// Выполнить запрос. write=false — база только для чтения: изменяющий запрос вернёт ошибку.
#[tauri::command]
pub async fn sqlite_query(state: State<'_, WorkspaceState>, path: String, sql: String, write: bool) -> Result<QueryResult, String> {
    let conn = open(&state, &path, write)?;
    let started = std::time::Instant::now();
    let sql = sql.trim().trim_end_matches(';').to_string();
    if sql.is_empty() {
        return Err("пустой запрос".into());
    }
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    if columns.is_empty() {
        // INSERT/UPDATE/DELETE/CREATE…
        let changes = stmt.execute([]).map_err(|e| {
            let msg = e.to_string();
            if msg.contains("readonly") || msg.contains("read-only") {
                "база открыта только для чтения — включите «Разрешить изменения»".to_string()
            } else {
                msg
            }
        })?;
        return Ok(QueryResult { columns, rows: vec![], truncated: false, changes: Some(changes), millis: started.elapsed().as_millis() as u64 });
    }
    let n = columns.len();
    let mut rows_out = Vec::new();
    let mut truncated = false;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if rows_out.len() >= MAX_ROWS {
            truncated = true;
            break;
        }
        rows_out.push((0..n).map(|i| row.get_ref(i).map(cell).unwrap_or(serde_json::Value::Null)).collect());
    }
    Ok(QueryResult { columns, rows: rows_out, truncated, changes: None, millis: started.elapsed().as_millis() as u64 })
}
