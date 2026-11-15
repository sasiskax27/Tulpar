//! Встроенный веб-сервер: раздаёт папку сайта по локальной сети — открыть
//! на компьютере и на телефоне. Ничего скачивать не нужно.

use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::phone::{lan_ip, read_request_limited, respond};

#[derive(Default)]
pub struct WebServerState(Mutex<Option<(Arc<AtomicBool>, u16, String)>>);

#[derive(Serialize)]
pub struct WebInfo {
    port: u16,
    root: String,
    local: String,
    lan: String,
}

fn mime(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wasm") => "application/wasm",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { b' ' } else { bytes[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn resolve(root: &Path, url: &str) -> Option<PathBuf> {
    let path = decode(url.split(['?', '#']).next().unwrap_or("/"));
    let mut p = root.to_path_buf();
    for c in Path::new(path.trim_start_matches('/')).components() {
        match c {
            Component::Normal(x) => p.push(x),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if p.is_dir() {
        p.push("index.html");
    }
    Some(p)
}

fn handle(mut stream: TcpStream, root: &Path) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Some(req) = read_request_limited(&stream, 1024) else { return };
    if req.method != "GET" && req.method != "HEAD" {
        respond(&mut stream, "405 Method Not Allowed", "text/plain", b"only GET");
        return;
    }
    match resolve(root, &req.path) {
        Some(p) if p.is_file() => match std::fs::read(&p) {
            Ok(body) => respond(&mut stream, "200 OK", mime(&p), &body),
            Err(_) => respond(&mut stream, "500 Internal Server Error", "text/plain", b"read error"),
        },
        Some(_) => {
            let body = "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;padding:40px'><h1>404</h1><p>Такого файла нет. Tulpar 🐎</p>";
            respond(&mut stream, "404 Not Found", "text/html; charset=utf-8", body.as_bytes())
        }
        None => respond(&mut stream, "403 Forbidden", "text/plain", b"forbidden"),
    }
}

#[tauri::command]
pub fn webserver_start(state: State<'_, WebServerState>, root: String) -> Result<WebInfo, String> {
    let mut guard = state.0.lock().map_err(|_| "состояние повреждено")?;
    if let Some((stop, _, _)) = guard.take() {
        stop.store(true, Ordering::Relaxed);
    }
    let dir = PathBuf::from(&root);
    if !dir.is_dir() {
        return Err("папка не найдена".into());
    }
    let listener = (5500..5530).find_map(|p| TcpListener::bind(("0.0.0.0", p)).ok()).ok_or("не удалось открыть порт 5500–5529")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let dir2 = dir.clone();
    std::thread::spawn(move || {
        while !stop2.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((s, _)) => {
                    let _ = s.set_nonblocking(false);
                    let d = dir2.clone();
                    std::thread::spawn(move || handle(s, &d));
                }
                Err(_) => std::thread::sleep(Duration::from_millis(40)),
            }
        }
    });
    *guard = Some((stop, port, root.clone()));
    Ok(WebInfo { port, root, local: format!("http://localhost:{port}/"), lan: format!("http://{}:{port}/", lan_ip()) })
}

#[tauri::command]
pub fn webserver_stop(state: State<'_, WebServerState>) -> Result<(), String> {
    if let Some((stop, _, _)) = state.0.lock().map_err(|_| "состояние повреждено")?.take() {
        stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn webserver_status(state: State<'_, WebServerState>) -> Result<Option<WebInfo>, String> {
    Ok(state.0.lock().map_err(|_| "состояние повреждено")?.as_ref().map(|(_, port, root)| WebInfo {
        port: *port,
        root: root.clone(),
        local: format!("http://localhost:{port}/"),
        lan: format!("http://{}:{port}/", lan_ip()),
    }))
}
