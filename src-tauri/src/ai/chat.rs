//! Чат с ИИ с потоковым ответом: текст приходит по кусочкам событиями
//! `ai:chunk`, как в обычных чат-ботах. Работает с OpenAI-совместимыми
//! серверами (Ollama, LM Studio, OpenRouter, OpenAI) и с Claude.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use super::{server_error, ANTHROPIC_VERSION};

#[derive(Default)]
pub struct ChatState {
    cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    id: String,
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
    system: String,
    messages: Vec<ChatMessage>,
    /// Ollama: размер контекста в токенах
    #[serde(default)]
    context_size: Option<u32>,
}

#[derive(Serialize, Clone)]
struct Chunk {
    id: String,
    text: String,
}

/// Вынуть кусок текста из одной строки SSE `data: {...}`.
fn delta_text(provider: &str, data: &str) -> Option<String> {
    if data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    if provider == "anthropic" {
        if v["type"] == "content_block_delta" && v["delta"]["type"] == "text_delta" {
            return v["delta"]["text"].as_str().map(str::to_owned);
        }
        None
    } else {
        v.pointer("/choices/0/delta/content")
            .or_else(|| v.pointer("/message/content")) // родной поток Ollama
            .and_then(Value::as_str)
            .map(str::to_owned)
    }
}

pub(crate) fn key_or_env(key: &str, env: &str) -> String {
    let k = key.trim();
    if k.is_empty() { std::env::var(env).unwrap_or_default() } else { k.to_owned() }
}

/// Отправить разговор и получать ответ по кусочкам. Возвращает полный текст.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, state: State<'_, ChatState>, request: ChatRequest) -> Result<String, String> {
    let base = request.base_url.trim().trim_end_matches('/').to_owned();
    if base.is_empty() || request.model.trim().is_empty() {
        return Err("ИИ не настроен: укажите сервер и модель в настройках".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    state.cancel.lock().map_err(|_| "состояние повреждено")?.insert(request.id.clone(), stop.clone());

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let is_anthropic = request.provider == "anthropic";
    let builder = if is_anthropic {
        let key = key_or_env(&request.api_key, "ANTHROPIC_API_KEY");
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
                "messages": request.messages,
                "stream": true,
            }))
    } else if request.provider == "ollama" {
        // Родной API Ollama: можно задать размер контекста (через /v1 он 2–4 тыс. токенов,
        // и длинный вопрос с кодом проекта молча обрезается)
        let host = base.trim_end_matches("/v1").trim_end_matches('/').to_owned();
        let mut messages = vec![ChatMessage { role: "system".into(), content: request.system.clone() }];
        messages.extend(request.messages.iter().cloned());
        client.post(format!("{host}/api/chat")).json(&json!({
            "model": request.model.trim(),
            "messages": messages,
            "stream": true,
            "options": { "num_ctx": request.context_size.unwrap_or(16384).clamp(2048, 131072) },
        }))
    } else {
        let mut messages = vec![ChatMessage { role: "system".into(), content: request.system.clone() }];
        messages.extend(request.messages.iter().cloned());
        let mut b = client.post(format!("{base}/chat/completions")).json(&json!({
            "model": request.model.trim(),
            "messages": messages,
            "stream": true,
        }));
        let key = key_or_env(&request.api_key, super::env_for(&request.provider));
        if !key.is_empty() {
            b = b.bearer_auth(key);
        }
        b
    };

    let result = async {
        let mut response = builder.send().await.map_err(|e| {
            if e.is_connect() { format!("не удалось подключиться к {base}. Сервер запущен?") } else { e.to_string() }
        })?;
        if !response.status().is_success() {
            let code = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(super::friendly_error(code, &server_error(&body)));
        }
        let mut full = String::new();
        let mut buffer: Vec<u8> = Vec::new();
        while let Some(bytes) = response.chunk().await.map_err(|e| format!("ответ прервался: {e}"))? {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            buffer.extend_from_slice(&bytes);
            // Разбираем только целые строки; хвост ждёт следующую порцию
            while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buffer.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                // Ollama присылает строки JSON без «data:»
                let data = match line.trim().strip_prefix("data:") {
                    Some(d) => d.trim(),
                    None if request.provider == "ollama" => line.trim(),
                    None => continue,
                };
                if let Some(text) = delta_text(&request.provider, data) {
                    if !text.is_empty() {
                        full.push_str(&text);
                        let _ = app.emit("ai:chunk", Chunk { id: request.id.clone(), text });
                    }
                }
            }
        }
        Ok(full)
    }
    .await;

    if let Ok(mut map) = state.cancel.lock() {
        map.remove(&request.id);
    }
    result
}

/// Остановить ответ: уже полученный текст останется.
#[tauri::command]
pub async fn ai_chat_cancel(state: State<'_, ChatState>, id: String) -> Result<(), String> {
    if let Some(flag) = state.cancel.lock().map_err(|_| "состояние повреждено")?.get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_and_anthropic_deltas() {
        assert_eq!(delta_text("ollama", r#"{"choices":[{"delta":{"content":"При"}}]}"#).as_deref(), Some("При"));
        assert_eq!(delta_text("ollama", "[DONE]"), None);
        assert_eq!(delta_text("ollama", r#"{"choices":[{"delta":{}}]}"#), None);
        assert_eq!(
            delta_text("anthropic", r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"вет"}}"#).as_deref(),
            Some("вет")
        );
        assert_eq!(delta_text("anthropic", r#"{"type":"message_start"}"#), None);
        assert_eq!(delta_text("ollama", r#"{"model":"q","message":{"role":"assistant","content":"Hi"},"done":false}"#).as_deref(), Some("Hi"));
    }
}
