//! «Телефон как второй экран»: маленький веб-сервер в локальной сети.
//! Телефон открывает адрес из QR-кода и видит состояние проекта (файл,
//! ошибки, тесты, терминал), может открыть предпросмотр сайта и дать
//! задачу ИИ-агенту. Доступ — только по случайному ключу из QR-кода.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct PhoneState {
    inner: Mutex<Option<Running>>,
    snapshot: Arc<Mutex<String>>,
    preview_port: Arc<Mutex<Option<u16>>>,
}

struct Running {
    stop: Arc<AtomicBool>,
    port: u16,
    token: String,
}

#[derive(Serialize)]
pub struct PhoneInfo {
    url: String,
    ip: String,
    port: u16,
}

const PAGE: &str = include_str!("phone.html");

/// IP этого компьютера в локальной сети (пакеты при этом не отправляются).
fn lan_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into())
}

fn respond(stream: &mut TcpStream, status: &str, kind: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> Option<Request> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = Vec::new();
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().unwrap_or(0).min(64 * 1024);
            }
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let mut body = vec![0; len];
    if len > 0 {
        reader.read_exact(&mut body).ok()?;
    }
    Some(Request { method, path, headers, body })
}

fn query_param(path: &str, key: &str) -> Option<String> {
    let q = path.split_once('?')?.1;
    q.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| v.to_string())
    })
}

/// Прокси на локальный dev-сервер: /preview/… → 127.0.0.1:PORT/…
fn proxy(mut client: TcpStream, req: &Request, port: u16) {
    let target_path = req.path.strip_prefix("/preview").unwrap_or("/");
    let target_path = if target_path.is_empty() { "/" } else { target_path };
    let Ok(mut upstream) = TcpStream::connect(("127.0.0.1", port)) else {
        respond(&mut client, "502 Bad Gateway", "text/plain; charset=utf-8", "Сайт не запущен".as_bytes());
        return;
    };
    let _ = upstream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut head = format!("{} {} HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n", req.method, target_path);
    for (k, v) in &req.headers {
        if !matches!(k.to_ascii_lowercase().as_str(), "host" | "connection" | "accept-encoding" | "upgrade") {
            head.push_str(&format!("{k}: {v}\r\n"));
        }
    }
    head.push_str("\r\n");
    if upstream.write_all(head.as_bytes()).is_err() || upstream.write_all(&req.body).is_err() {
        return;
    }
    let mut buf = [0u8; 16 * 1024];
    while let Ok(n) = upstream.read(&mut buf) {
        if n == 0 || client.write_all(&buf[..n]).is_err() {
            break;
        }
    }
    let _ = client.shutdown(Shutdown::Both);
}

fn handle(mut stream: TcpStream, app: &AppHandle, token: &str, snapshot: &Arc<Mutex<String>>, preview: &Arc<Mutex<Option<u16>>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Some(req) = read_request(&stream) else { return };
    let cookie_ok = req
        .headers
        .iter()
        .any(|(k, v)| k.eq_ignore_ascii_case("cookie") && v.split(';').any(|c| c.trim() == format!("tulpar={token}")));
    let token_ok = query_param(&req.path, "k").as_deref() == Some(token) || cookie_ok;
    if !token_ok {
        respond(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", "Откройте адрес из QR-кода в Tulpar".as_bytes());
        return;
    }
    let route = req.path.split('?').next().unwrap_or("/");
    if route.starts_with("/preview") {
        if let Some(port) = *preview.lock().unwrap() {
            proxy(stream, &req, port);
        } else {
            respond(&mut stream, "404 Not Found", "text/plain; charset=utf-8", "Предпросмотр сайта не открыт в Tulpar".as_bytes());
        }
        return;
    }
    match (req.method.as_str(), route) {
        ("GET", "/") => {
            // Ключ запоминаем в cookie — тогда работают и ссылки предпросмотра
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nSet-Cookie: tulpar={token}; Path=/; SameSite=Strict\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                PAGE.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(PAGE.as_bytes());
        }
        ("GET", "/api/state") => {
            let s = snapshot.lock().unwrap().clone();
            respond(&mut stream, "200 OK", "application/json; charset=utf-8", if s.is_empty() { b"{}".as_slice() } else { s.as_bytes() });
        }
        ("POST", "/api/agent") => {
            let text = String::from_utf8_lossy(&req.body).trim().chars().take(4000).collect::<String>();
            if !text.is_empty() {
                let _ = app.emit("phone:agent", text);
            }
            respond(&mut stream, "200 OK", "application/json", b"{\"ok\":true}");
        }
        _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
    }
}

#[tauri::command]
pub async fn phone_start(app: AppHandle, state: State<'_, PhoneState>, token: String) -> Result<PhoneInfo, String> {
    if token.len() < 16 || !token.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("некорректный ключ".into());
    }
    let mut guard = state.inner.lock().map_err(|_| "состояние повреждено")?;
    if let Some(r) = guard.as_ref() {
        let ip = lan_ip();
        return Ok(PhoneInfo { url: format!("http://{ip}:{}/?k={}", r.port, r.token), ip, port: r.port });
    }
    let listener = (47800..47820)
        .find_map(|p| TcpListener::bind(("0.0.0.0", p)).ok())
        .ok_or("не удалось открыть порт для телефона")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let (stop2, snapshot, preview, tok) = (stop.clone(), state.snapshot.clone(), state.preview_port.clone(), token.clone());
    std::thread::spawn(move || {
        while !stop2.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let (app, tok, snapshot, preview) = (app.clone(), tok.clone(), snapshot.clone(), preview.clone());
                    std::thread::spawn(move || handle(stream, &app, &tok, &snapshot, &preview));
                }
                Err(_) => std::thread::sleep(Duration::from_millis(80)),
            }
        }
    });
    *guard = Some(Running { stop, port, token: token.clone() });
    let ip = lan_ip();
    Ok(PhoneInfo { url: format!("http://{ip}:{port}/?k={token}"), ip, port })
}

#[tauri::command]
pub async fn phone_stop(state: State<'_, PhoneState>) -> Result<(), String> {
    if let Some(r) = state.inner.lock().map_err(|_| "состояние повреждено")?.take() {
        r.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn phone_set_state(state: State<'_, PhoneState>, snapshot: String, preview_port: Option<u16>) -> Result<(), String> {
    *state.snapshot.lock().map_err(|_| "состояние повреждено")? = snapshot;
    *state.preview_port.lock().map_err(|_| "состояние повреждено")? = preview_port;
    Ok(())
}
