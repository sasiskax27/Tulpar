//! Агент в чате: ИИ получает список инструментов (прочитать файл, найти,
//! изменить, запустить команду) и сам решает, какие вызвать. Ядро делает
//! один шаг разговора с вызовом инструментов, а сами инструменты выполняет
//! интерфейс — там же пользователь подтверждает правки и команды.
//!
//! Разговор хранится в нейтральном виде и переводится в формат сервера:
//! OpenAI-совместимый (`tools` / `tool_calls`) или Claude (`tool_use` / `tool_result`).

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use super::chat::key_or_env;
use super::{server_error, ANTHROPIC_VERSION};
use crate::workspace::{atomic_write, current_root, resolve, WorkspaceState};

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
}

/// Сообщение разговора агента.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    /// user | assistant | tool
    role: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    tool_calls: Vec<ToolCall>,
    /// Для role = tool: на какой вызов это ответ
    #[serde(default)]
    tool_call_id: String,
}

#[derive(Deserialize, Clone)]
pub struct ToolSpec {
    name: String,
    description: String,
    parameters: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRequest {
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
    system: String,
    messages: Vec<AgentMessage>,
    tools: Vec<ToolSpec>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReply {
    text: String,
    tool_calls: Vec<ToolCall>,
}

// ---------- перевод в формат сервера ----------

fn openai_messages(system: &str, messages: &[AgentMessage]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": system })];
    for m in messages {
        match m.role.as_str() {
            "assistant" => {
                let mut msg = json!({ "role": "assistant", "content": m.content });
                if !m.tool_calls.is_empty() {
                    msg["tool_calls"] = m
                        .tool_calls
                        .iter()
                        .map(|c| {
                            json!({
                                "id": c.id,
                                "type": "function",
                                "function": { "name": c.name, "arguments": c.args.to_string() },
                            })
                        })
                        .collect();
                }
                out.push(msg);
            }
            "tool" => out.push(json!({ "role": "tool", "tool_call_id": m.tool_call_id, "content": m.content })),
            _ => out.push(json!({ "role": "user", "content": m.content })),
        }
    }
    out
}

fn anthropic_messages(messages: &[AgentMessage]) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if !m.content.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": m.content }));
                }
                for c in &m.tool_calls {
                    let input = if c.args.is_object() { c.args.clone() } else { json!({}) };
                    blocks.push(json!({ "type": "tool_use", "id": c.id, "name": c.name, "input": input }));
                }
                if blocks.is_empty() {
                    blocks.push(json!({ "type": "text", "text": "…" }));
                }
                out.push(json!({ "role": "assistant", "content": blocks }));
            }
            "tool" => {
                let block = json!({ "type": "tool_result", "tool_use_id": m.tool_call_id, "content": m.content });
                // Несколько результатов подряд — в одном сообщении пользователя
                if let Some(last) = out.last_mut() {
                    if last["role"] == "user" && last["content"].is_array()
                        && last["content"][0]["type"] == "tool_result"
                    {
                        last["content"].as_array_mut().unwrap().push(block);
                        continue;
                    }
                }
                out.push(json!({ "role": "user", "content": [block] }));
            }
            _ => out.push(json!({ "role": "user", "content": m.content })),
        }
    }
    out
}

/// Аргументы вызова: строка JSON (OpenAI) или уже объект (Ollama, Claude).
fn parse_args(v: &Value) -> Value {
    match v {
        Value::String(s) => serde_json::from_str(s).unwrap_or_else(|_| json!({})),
        Value::Null => json!({}),
        other => other.clone(),
    }
}

fn parse_reply(provider: &str, v: &Value) -> AgentReply {
    let mut text = String::new();
    let mut tool_calls = Vec::new();
    if provider == "anthropic" {
        for (i, block) in v["content"].as_array().into_iter().flatten().enumerate() {
            match block["type"].as_str() {
                Some("text") => text.push_str(block["text"].as_str().unwrap_or("")),
                Some("tool_use") => tool_calls.push(ToolCall {
                    id: block["id"].as_str().map(str::to_owned).unwrap_or_else(|| format!("call_{i}")),
                    name: block["name"].as_str().unwrap_or("").to_owned(),
                    args: parse_args(&block["input"]),
                }),
                _ => {}
            }
        }
    } else {
        let msg = &v["choices"][0]["message"];
        text = msg["content"].as_str().unwrap_or("").to_owned();
        for (i, c) in msg["tool_calls"].as_array().into_iter().flatten().enumerate() {
            tool_calls.push(ToolCall {
                id: c["id"].as_str().filter(|s| !s.is_empty()).map(str::to_owned).unwrap_or_else(|| format!("call_{i}")),
                name: c["function"]["name"].as_str().unwrap_or("").to_owned(),
                args: parse_args(&c["function"]["arguments"]),
            });
        }
    }
    AgentReply { text, tool_calls }
}

/// Один шаг агента: отправить разговор, получить текст и/или вызовы инструментов.
#[tauri::command]
pub async fn ai_agent_step(request: AgentRequest) -> Result<AgentReply, String> {
    let base = request.base_url.trim().trim_end_matches('/').to_owned();
    if base.is_empty() || request.model.trim().is_empty() {
        return Err("ИИ не настроен: укажите сервер и модель в настройках".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let is_anthropic = request.provider == "anthropic";
    let builder = if is_anthropic {
        let key = key_or_env(&request.api_key, "ANTHROPIC_API_KEY");
        if key.is_empty() {
            return Err("не указан ключ API".into());
        }
        let tools: Vec<Value> = request
            .tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.parameters }))
            .collect();
        client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&json!({
                "model": request.model.trim(),
                "max_tokens": 8192,
                "system": request.system,
                "messages": anthropic_messages(&request.messages),
                "tools": tools,
            }))
    } else {
        let tools: Vec<Value> = request
            .tools
            .iter()
            .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.parameters } }))
            .collect();
        let mut b = client.post(format!("{base}/chat/completions")).json(&json!({
            "model": request.model.trim(),
            "messages": openai_messages(&request.system, &request.messages),
            "tools": tools,
            "stream": false,
        }));
        let key = key_or_env(&request.api_key, "OPENAI_API_KEY");
        if !key.is_empty() {
            b = b.bearer_auth(key);
        }
        b
    };
    let response = builder.send().await.map_err(|e| {
        if e.is_connect() {
            format!("не удалось подключиться к {base}. Сервер запущен?")
        } else if e.is_timeout() {
            "ИИ не ответил за 5 минут".into()
        } else {
            e.to_string()
        }
    })?;
    let code = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    if !(200..300).contains(&code) {
        let msg = server_error(&body);
        if msg.contains("does not support tools") {
            return Err(format!(
                "модель {} не умеет работать с инструментами. Для агента выберите, например, qwen2.5-coder:7b, qwen3 или llama3.1",
                request.model.trim()
            ));
        }
        return Err(format!("сервер ответил ошибкой {code}: {msg}"));
    }
    let v: Value = serde_json::from_str(&body).map_err(|_| "сервер прислал непонятный ответ".to_string())?;
    Ok(parse_reply(&request.provider, &v))
}

// ---------- инструменты, которым нужно ядро ----------

/// Путь внутри проекта без «..»; родительские папки создаются при записи.
fn inside_root(root: &Path, path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let joined = if p.is_absolute() { p } else { root.join(p) };
    let mut clean = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::ParentDir => return Err("путь не должен содержать «..»".into()),
            Component::CurDir => {}
            other => clean.push(other.as_os_str()),
        }
    }
    if !clean.starts_with(root) {
        return Err(format!("доступ запрещён: {path} вне открытой папки"));
    }
    if clean.components().any(|c| c.as_os_str() == ".git") {
        return Err("папку .git менять нельзя".into());
    }
    Ok(clean)
}

/// Записать файл по просьбе агента (создаёт недостающие папки).
#[tauri::command]
pub async fn agent_write(state: State<'_, WorkspaceState>, path: String, content: String) -> Result<String, String> {
    let root = current_root(&state)?;
    let target = inside_root(&root, &path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = resolve(&state, &target.to_string_lossy())?;
    atomic_write(&file, content.as_bytes())?;
    Ok(crate::workspace::to_string(&file))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    code: Option<i32>,
    output: String,
    timed_out: bool,
}

const MAX_OUTPUT: usize = 30_000;

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("powershell");
        // Иначе PowerShell 5.1 перекодирует вывод программ в OEM-866 и кириллица ломается
        let script = format!(
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; {command}"
        );
        c.args(["-NoProfile", "-NonInteractive", "-Command", script.as_str()]);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    }
}

/// Выполнить команду в папке проекта и вернуть её вывод (для агента).
#[tauri::command]
pub async fn agent_run(state: State<'_, WorkspaceState>, command: String, timeout_secs: Option<u64>) -> Result<RunResult, String> {
    let root = current_root(&state)?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120).clamp(5, 900));
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = shell_command(&command)
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .spawn()
            .map_err(|e| format!("не удалось запустить: {e}"))?;
        let mut out = child.stdout.take().unwrap();
        let mut err = child.stderr.take().unwrap();
        let reader_out = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = out.read_to_end(&mut buf);
            buf
        });
        let reader_err = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf);
            buf
        });
        let started = Instant::now();
        let mut timed_out = false;
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
                break Some(s);
            }
            if started.elapsed() > timeout {
                let _ = child.kill();
                let _ = child.wait();
                timed_out = true;
                break None;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let mut output = String::from_utf8_lossy(&reader_out.join().unwrap_or_default()).into_owned();
        let errors = String::from_utf8_lossy(&reader_err.join().unwrap_or_default()).into_owned();
        if !errors.trim().is_empty() {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            output.push_str(&errors);
        }
        if output.len() > MAX_OUTPUT {
            // Конец вывода важнее начала: там ошибки и итог
            let mut cut = output.len() - MAX_OUTPUT;
            while !output.is_char_boundary(cut) {
                cut += 1;
            }
            output = format!("…(начало вывода обрезано)\n{}", &output[cut..]);
        }
        Ok(RunResult { code: status.and_then(|s| s.code()), output, timed_out })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> AgentMessage {
        AgentMessage { role: role.into(), content: content.into(), tool_calls: vec![], tool_call_id: String::new() }
    }

    #[test]
    fn parses_openai_tool_calls() {
        let v = json!({"choices":[{"message":{"content":null,"tool_calls":[
            {"id":"c1","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"a.py\"}"}},
            {"id":"","function":{"name":"list_files","arguments":{"path":"src"}}}
        ]}}]});
        let r = parse_reply("ollama", &v);
        assert_eq!(r.text, "");
        assert_eq!(r.tool_calls.len(), 2);
        assert_eq!(r.tool_calls[0].args["path"], "a.py");
        assert_eq!(r.tool_calls[1].id, "call_1");
        assert_eq!(r.tool_calls[1].args["path"], "src");
    }

    #[test]
    fn parses_anthropic_tool_use() {
        let v = json!({"content":[{"type":"text","text":"Смотрю"},{"type":"tool_use","id":"tu1","name":"search","input":{"query":"main"}}]});
        let r = parse_reply("anthropic", &v);
        assert_eq!(r.text, "Смотрю");
        assert_eq!(r.tool_calls[0].name, "search");
        assert_eq!(r.tool_calls[0].args["query"], "main");
    }

    #[test]
    fn anthropic_merges_tool_results() {
        let mut a = msg("assistant", "");
        a.tool_calls = vec![
            ToolCall { id: "1".into(), name: "x".into(), args: json!({}) },
            ToolCall { id: "2".into(), name: "y".into(), args: json!({}) },
        ];
        let mut t1 = msg("tool", "r1");
        t1.tool_call_id = "1".into();
        let mut t2 = msg("tool", "r2");
        t2.tool_call_id = "2".into();
        let out = anthropic_messages(&[msg("user", "q"), a, t1, t2]);
        assert_eq!(out.len(), 3);
        assert_eq!(out[2]["content"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn openai_serializes_arguments_as_string() {
        let mut a = msg("assistant", "");
        a.tool_calls = vec![ToolCall { id: "1".into(), name: "x".into(), args: json!({"p": 1}) }];
        let out = openai_messages("sys", &[a]);
        assert_eq!(out[1]["tool_calls"][0]["function"]["arguments"], "{\"p\":1}");
    }

    #[test]
    fn rejects_paths_outside() {
        let root = if cfg!(windows) { PathBuf::from("C:\\proj") } else { PathBuf::from("/proj") };
        assert!(inside_root(&root, "src/a.rs").is_ok());
        assert!(inside_root(&root, "../x").is_err());
        assert!(inside_root(&root, ".git/config").is_err());
        let outside = if cfg!(windows) { "D:\\x" } else { "/etc/passwd" };
        assert!(inside_root(&root, outside).is_err());
    }
}
