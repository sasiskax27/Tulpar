//! Серверные базы данных: PostgreSQL, MySQL/MariaDB, MongoDB.
//! Подключение на каждый запрос (просто и надёжно для просмотрщика), с
//! ограничением по времени. Значения отдаются как текст/JSON — для таблицы.

use std::time::{Duration, Instant};

use futures_util::TryStreamExt;
use serde::Serialize;
use serde_json::Value;
use tokio::time::timeout;

const MAX_ROWS: usize = 1000;
const MAX_CELL: usize = 2000;
const CONNECT: Duration = Duration::from_secs(15);
const QUERY: Duration = Duration::from_secs(90);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbResult {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    truncated: bool,
    changes: Option<u64>,
    millis: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbObject {
    schema: String,
    name: String,
    kind: String,
}

fn short(s: &str) -> Value {
    if s.chars().count() > MAX_CELL {
        Value::String(format!("{}…", s.chars().take(MAX_CELL).collect::<String>()))
    } else {
        Value::String(s.to_string())
    }
}

/// Убрать пароль из текста ошибки — строка подключения могла попасть в сообщение.
fn clean_err(e: impl std::fmt::Display, url: &str) -> String {
    let mut msg = e.to_string();
    if let Some(pw) = password_of(url) {
        if !pw.is_empty() {
            msg = msg.replace(&pw, "***");
        }
    }
    msg
}

fn password_of(url: &str) -> Option<String> {
    let after = url.split("://").nth(1)?;
    let creds = after.split('@').next()?;
    if !after.contains('@') {
        return None;
    }
    creds.split_once(':').map(|(_, p)| p.to_string())
}

// ---------- PostgreSQL ----------

async fn pg_client(url: &str) -> Result<tokio_postgres::Client, String> {
    let tls = native_tls::TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let connector = postgres_native_tls::MakeTlsConnector::new(tls);
    let (client, conn) = timeout(CONNECT, tokio_postgres::connect(url, connector))
        .await
        .map_err(|_| "сервер не ответил за 15 секунд".to_string())?
        .map_err(|e| clean_err(e, url))?;
    tauri::async_runtime::spawn(async move {
        let _ = conn.await;
    });
    Ok(client)
}

async fn pg_query(url: &str, sql: &str) -> Result<DbResult, String> {
    let started = Instant::now();
    let client = pg_client(url).await?;
    let messages = timeout(QUERY, client.simple_query(sql))
        .await
        .map_err(|_| "запрос шёл дольше 90 секунд".to_string())?
        .map_err(|e| clean_err(e, url))?;
    let mut columns: Vec<String> = Vec::new();
    let mut rows = Vec::new();
    let mut truncated = false;
    let mut changes = None;
    for m in messages {
        match m {
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                if rows.len() >= MAX_ROWS {
                    truncated = true;
                    continue;
                }
                rows.push((0..row.len()).map(|i| row.get(i).map(short).unwrap_or(Value::Null)).collect());
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(n) => {
                if columns.is_empty() {
                    changes = Some(n);
                }
            }
            _ => {}
        }
    }
    Ok(DbResult { columns, rows, truncated, changes, millis: started.elapsed().as_millis() as u64 })
}

// ---------- MySQL / MariaDB ----------

fn my_value(v: mysql_async::Value) -> Value {
    match v {
        mysql_async::Value::NULL => Value::Null,
        mysql_async::Value::Bytes(b) => short(&String::from_utf8_lossy(&b)),
        mysql_async::Value::Int(i) => serde_json::json!(i),
        mysql_async::Value::UInt(u) => serde_json::json!(u),
        mysql_async::Value::Float(f) => serde_json::json!(f),
        mysql_async::Value::Double(d) => serde_json::json!(d),
        other => Value::String(other.as_sql(true).trim_matches('\'').to_string()),
    }
}

async fn my_query(url: &str, sql: &str) -> Result<DbResult, String> {
    use mysql_async::prelude::Queryable;
    let started = Instant::now();
    let opts = mysql_async::Opts::from_url(url).map_err(|e| clean_err(e, url))?;
    let pool = mysql_async::Pool::new(opts);
    let result = async {
        let mut conn = timeout(CONNECT, pool.get_conn())
            .await
            .map_err(|_| "сервер не ответил за 15 секунд".to_string())?
            .map_err(|e| clean_err(e, url))?;
        let mut res = timeout(QUERY, conn.query_iter(sql))
            .await
            .map_err(|_| "запрос шёл дольше 90 секунд".to_string())?
            .map_err(|e| clean_err(e, url))?;
        let columns: Vec<String> = res.columns_ref().iter().map(|c| c.name_str().to_string()).collect();
        let raw: Vec<mysql_async::Row> = res.collect().await.map_err(|e| clean_err(e, url))?;
        let changes = if columns.is_empty() { Some(res.affected_rows()) } else { None };
        drop(res);
        let truncated = raw.len() > MAX_ROWS;
        let rows = raw.into_iter().take(MAX_ROWS).map(|r| r.unwrap().into_iter().map(my_value).collect()).collect();
        drop(conn);
        Ok::<_, String>(DbResult { columns, rows, truncated, changes, millis: started.elapsed().as_millis() as u64 })
    }
    .await;
    let _ = pool.disconnect().await;
    result
}

// ---------- команды ----------

/// kind: postgres | mysql
#[tauri::command]
pub async fn db_query(kind: String, url: String, sql: String) -> Result<DbResult, String> {
    let sql = sql.trim().to_string();
    if sql.is_empty() {
        return Err("пустой запрос".into());
    }
    match kind.as_str() {
        "postgres" => pg_query(&url, &sql).await,
        "mysql" => my_query(&url, &sql).await,
        _ => Err("неизвестный тип базы".into()),
    }
}

/// Таблицы и представления (без системных схем).
#[tauri::command]
pub async fn db_tables(kind: String, url: String) -> Result<Vec<DbObject>, String> {
    let sql = match kind.as_str() {
        "postgres" => "SELECT table_schema, table_name, table_type FROM information_schema.tables \
                       WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name",
        "mysql" => "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
                    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
        _ => return Err("неизвестный тип базы".into()),
    };
    let r = db_query(kind, url, sql.into()).await?;
    Ok(r.rows
        .into_iter()
        .map(|row| {
            let s = |i: usize| row.get(i).and_then(|v| v.as_str()).unwrap_or("").to_string();
            DbObject { schema: s(0), name: s(1), kind: if s(2).contains("VIEW") { "view".into() } else { "table".into() } }
        })
        .collect())
}

// ---------- MongoDB ----------

async fn mongo_client(url: &str) -> Result<mongodb::Client, String> {
    let mut opts = timeout(CONNECT, mongodb::options::ClientOptions::parse(url))
        .await
        .map_err(|_| "сервер не ответил за 15 секунд".to_string())?
        .map_err(|e| clean_err(e, url))?;
    opts.server_selection_timeout = Some(CONNECT);
    opts.app_name = Some("Tulpar".into());
    mongodb::Client::with_options(opts).map_err(|e| clean_err(e, url))
}

/// Базы и коллекции (с примерным числом документов).
#[tauri::command]
pub async fn mongo_collections(url: String) -> Result<Vec<DbObject>, String> {
    let client = mongo_client(&url).await?;
    let names = client.list_database_names().await.map_err(|e| clean_err(e, &url))?;
    let mut out = Vec::new();
    for db_name in names.into_iter().filter(|n| !matches!(n.as_str(), "admin" | "local" | "config")) {
        let db = client.database(&db_name);
        let mut colls = db.list_collection_names().await.map_err(|e| clean_err(e, &url))?;
        colls.sort();
        for c in colls {
            out.push(DbObject { schema: db_name.clone(), name: c, kind: "collection".into() });
        }
    }
    Ok(out)
}

/// Документы коллекции. filter — JSON (как в mongosh, но с кавычками у ключей).
#[tauri::command]
pub async fn mongo_find(url: String, db: String, collection: String, filter: String, limit: Option<i64>) -> Result<DbResult, String> {
    use mongodb::bson::{Bson, Document};
    let started = Instant::now();
    let filter_doc: Document = if filter.trim().is_empty() {
        Document::new()
    } else {
        let json: Value = serde_json::from_str(&filter).map_err(|e| format!("фильтр — не JSON: {e}"))?;
        match Bson::try_from(json).map_err(|e| format!("фильтр: {e}"))? {
            Bson::Document(d) => d,
            _ => return Err("фильтр должен быть объектом { … }".into()),
        }
    };
    let client = mongo_client(&url).await?;
    let coll = client.database(&db).collection::<Document>(&collection);
    let limit = limit.unwrap_or(200).clamp(1, MAX_ROWS as i64);
    let mut cursor = timeout(QUERY, coll.find(filter_doc).limit(limit))
        .await
        .map_err(|_| "запрос шёл дольше 90 секунд".to_string())?
        .map_err(|e| clean_err(e, &url))?;
    let mut docs: Vec<serde_json::Map<String, Value>> = Vec::new();
    while let Some(doc) = cursor.try_next().await.map_err(|e| clean_err(e, &url))? {
        if let Value::Object(map) = Bson::Document(doc).into_relaxed_extjson() {
            docs.push(map);
        }
    }
    // Колонки — объединение ключей в порядке появления, _id первым
    let mut columns: Vec<String> = Vec::new();
    for d in &docs {
        for k in d.keys() {
            if !columns.contains(k) {
                columns.push(k.clone());
            }
        }
    }
    if let Some(i) = columns.iter().position(|c| c == "_id") {
        let id = columns.remove(i);
        columns.insert(0, id);
    }
    let rows = docs
        .iter()
        .map(|d| {
            columns
                .iter()
                .map(|c| match d.get(c) {
                    None | Some(Value::Null) => Value::Null,
                    Some(Value::String(s)) => short(s),
                    Some(v @ (Value::Number(_) | Value::Bool(_))) => v.clone(),
                    Some(v) => short(&v.to_string()),
                })
                .collect()
        })
        .collect();
    Ok(DbResult { columns, rows, truncated: false, changes: None, millis: started.elapsed().as_millis() as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_password() {
        let url = "postgres://user:s3cret@host:5432/db";
        assert_eq!(password_of(url).as_deref(), Some("s3cret"));
        assert_eq!(clean_err("failed for postgres://user:s3cret@host", url), "failed for postgres://user:***@host");
    }
}
