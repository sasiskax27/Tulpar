//! Вход в ИИ-сервисы через браузер, без ручного копирования ключа.
//! - OpenRouter: OAuth PKCE. Браузер возвращается на http://localhost:PORT/callback,
//!   здесь мы ловим этот один запрос и отдаём код фронтенду.
//! - GitHub Models: берём токен у уже выполненного входа GitHub CLI (`gh auth token`).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::time::{Duration, Instant};

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Tulpar</title>\
<body style=\"font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><div style=\"font-size:48px\">✅</div><h2>Вход выполнен</h2>\
<p>Можно закрыть эту вкладку и вернуться в Tulpar.</p></div>";

/// Достаём строку запроса из первой строки HTTP: "GET /callback?code=… HTTP/1.1".
pub(crate) fn query_of(request_line: &str) -> Option<String> {
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?')?;
    if !path.starts_with("/callback") {
        return None;
    }
    Some(query.to_owned())
}

/// Ждать возврата браузера на localhost:port/callback. Возвращает строку
/// запроса (code=…&state=…). Слушаем только 127.0.0.1 и не дольше timeout.
#[tauri::command]
pub async fn oauth_capture(port: u16, timeout_secs: Option<u64>) -> Result<String, String> {
    if port < 1024 {
        return Err("неверный порт".into());
    }
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(300).min(900));
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("порт {port} занят: {e}"))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let start = Instant::now();
        loop {
            if start.elapsed() > timeout {
                return Err("время на вход вышло — попробуйте ещё раз".into());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 8192];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let text = String::from_utf8_lossy(&buf[..n]);
                    let first = text.lines().next().unwrap_or("");
                    match query_of(first) {
                        Some(q) => {
                            let body = DONE_PAGE.as_bytes();
                            let head = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                body.len()
                            );
                            let _ = stream.write_all(head.as_bytes());
                            let _ = stream.write_all(body);
                            return Ok(q);
                        }
                        None => {
                            // favicon и прочее — просто отвечаем 404 и ждём дальше
                            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Токен GitHub из GitHub CLI. Подходит для GitHub Models.
#[tauri::command]
pub async fn github_cli_token() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut c = Command::new("gh");
        c.args(["auth", "token"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000);
        }
        let out = c.output().map_err(|_| "GitHub CLI (gh) не установлен".to_string())?;
        let token = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        if !out.status.success() || token.is_empty() {
            return Err("GitHub CLI не выполнил вход".into());
        }
        Ok(token)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::query_of;

    #[test]
    fn parses_callback() {
        assert_eq!(query_of("GET /callback?code=abc&state=x HTTP/1.1").as_deref(), Some("code=abc&state=x"));
        assert_eq!(query_of("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(query_of("GET /callback HTTP/1.1"), None);
        assert_eq!(query_of(""), None);
    }
}
