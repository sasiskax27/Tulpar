// HTTP-клиент для панели «Запросы»: запрос уходит из Rust, поэтому нет
// ограничений CORS, как в браузере. Тело ответа — текст (до 5 МБ).
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
pub struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_secs: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
    millis: u128,
    size: usize,
    truncated: bool,
}

const LIMIT: usize = 5 * 1024 * 1024;

#[tauri::command]
pub async fn http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let url = request.url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("адрес должен начинаться с http:// или https://".into());
    }
    let method = reqwest::Method::from_bytes(request.method.trim().to_uppercase().as_bytes())
        .map_err(|_| "неизвестный метод".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(request.timeout_secs.unwrap_or(30).clamp(1, 600)))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let mut b = client.request(method, url);
    for (k, v) in &request.headers {
        let k = k.trim();
        if !k.is_empty() {
            b = b.header(k, v.trim());
        }
    }
    if let Some(body) = request.body {
        if !body.is_empty() {
            b = b.body(body);
        }
    }
    let start = Instant::now();
    let response = b.send().await.map_err(|e| {
        if e.is_timeout() {
            "сервер не ответил вовремя".to_string()
        } else if e.is_connect() {
            format!("не удалось подключиться: {e}")
        } else {
            e.to_string()
        }
    })?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned()))
        .collect();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let millis = start.elapsed().as_millis();
    let size = bytes.len();
    let truncated = size > LIMIT;
    let body = String::from_utf8_lossy(&bytes[..size.min(LIMIT)]).into_owned();
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
        millis,
        size,
        truncated,
    })
}
