//! Запросы к ИИ для правки кода. Ядро делает сам HTTP-запрос (у веб-интерфейса
//! мешали бы ограничения браузера) и возвращает текст ответа.
//!
//! Поддерживаются:
//! - `ollama` и `openai` — любой сервер с OpenAI-совместимым API
//!   (Ollama, LM Studio, OpenRouter, OpenAI и другие);
//! - `anthropic` — Claude через Messages API.
//!
//! В сеть Tulpar ходит только по явному действию пользователя и только на адрес
//! из его настроек.

pub mod agent;
pub mod chat;

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

pub(crate) const ANTHROPIC_VERSION: &str = "2026-10-21";
const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
    system: String,
    prompt: String,
}

fn snippet(text: &str) -> String {
    text.chars().take(300).collect()
}

/// Сообщение об ошибке из ответа сервера: и OpenAI, и Anthropic кладут его в error.message.
pub(crate) fn server_error(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.get("error"))
                .and_then(|m| m.as_str().map(str::to_owned))
        })
        .unwrap_or_else(|| snippet(body))
}

fn api_key(request: &AiRequest, env_name: &str) -> String {
    let key = request.api_key.trim();
    if key.is_empty() {
        std::env::var(env_name).unwrap_or_default()
    } else {
        key.to_owned()
    }
}

#[tauri::command]
pub async fn ai_complete(request: AiRequest) -> Result<String, String> {
    let base = request.base_url.trim().trim_end_matches('/').to_owned();
    if base.is_empty() {
        return Err("не указан адрес сервера ИИ".into());
    }
    if request.model.trim().is_empty() {
        return Err("не указана модель ИИ".into());
    }
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let is_anthropic = request.provider == "anthropic";
    let builder = if is_anthropic {
        let key = api_key(&request, "ANTHROPIC_API_KEY");
        if key.is_empty() {
            return Err("не указан ключ API".into());
        }
        client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&json!({
                "model": request.model.trim(),
                "max_tokens": 8192,
                "system": request.system,
                "messages": [{ "role": "user", "content": request.prompt }],
            }))
    } else {
        let key = api_key(&request, "OPENAI_API_KEY");
        let mut b = client.post(format!("{base}/chat/completions")).json(&json!({
            "model": request.model.trim(),
            "stream": false,
            "messages": [
                { "role": "system", "content": request.system },
                { "role": "user", "content": request.prompt },
            ],
        }));
        // Локальным серверам (Ollama, LM Studio) ключ не нужен
        if !key.is_empty() {
            b = b.bearer_auth(key);
        }
        b
    };

    let response = builder.send().await.map_err(|e| {
        if e.is_connect() {
            format!("не удалось подключиться к {base}. Сервер запущен?")
        } else if e.is_timeout() {
            "ИИ не ответил за 3 минуты".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("сервер ответил ошибкой {}: {}", status.as_u16(), server_error(&body)));
    }
    let value: Value =
        serde_json::from_str(&body).map_err(|_| format!("непонятный ответ сервера: {}", snippet(&body)))?;

    let text = if is_anthropic {
        // Ответ — список блоков; берём только текстовые
        value["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b["type"] == "text")
                    .filter_map(|b| b["text"].as_str())
                    .collect::<String>()
            })
            .unwrap_or_default()
    } else {
        value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    if text.trim().is_empty() {
        return Err("ИИ вернул пустой ответ".into());
    }
    Ok(text)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillRequest {
    /// Адрес Ollama без «/v1», например http://localhost:11434
    host: String,
    model: String,
    prefix: String,
    suffix: String,
    max_tokens: u32,
}

/// Дописать код в месте курсора (fill-in-the-middle) через Ollama: модель видит
/// текст до курсора и после него. Модели для кода (Qwen Coder и др.) обучены
/// именно на этом, поэтому подсказки быстрые и точные даже у маленьких моделей.
#[tauri::command]
pub async fn ai_fill(request: FillRequest) -> Result<String, String> {
    let host = request.host.trim().trim_end_matches('/').trim_end_matches("/v1").to_owned();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(format!("{host}/api/generate"))
        .json(&json!({
            "model": request.model,
            "prompt": request.prefix,
            "suffix": request.suffix,
            "stream": false,
            "options": {
                "num_predict": request.max_tokens,
                "temperature": 0.2,
                "top_p": 0.9,
                "stop": ["\n\n\n"]
            }
        }))
        .send()
        .await
        .map_err(|e| if e.is_connect() { "Ollama не запущена".to_string() } else { e.to_string() })?;
    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Ollama: {}", server_error(&body)));
    }
    let value: Value = serde_json::from_str(&body).map_err(|_| snippet(&body))?;
    Ok(value["response"].as_str().unwrap_or_default().to_owned())
}
