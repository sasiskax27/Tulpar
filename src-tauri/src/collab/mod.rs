//! «Вместе по сети»: несколько Tulpar в одной Wi-Fi правят одни файлы.
//! Хозяин запускает этот маленький сервер, гости подключаются по ссылке с
//! ключом. Сервер только пересылает сообщения: гость → хозяин (событие
//! collab:inbox) и хозяин → все гости (журнал с номерами, длинный опрос).
//! Сама логика правок (OT) — в интерфейсе хозяина.

use std::collections::VecDeque;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::phone::{lan_ip, query_param, read_request_limited, respond};

const KEEP: usize = 20_000;

#[derive(Default)]
struct Log {
    /// Номер последнего события
    seq: u64,
    events: VecDeque<(u64, String)>,
}

#[derive(Default)]
pub struct CollabState {
    inner: Mutex<Option<Running>>,
    log: Arc<(Mutex<Log>, Condvar)>,
}

struct Running {
    stop: Arc<AtomicBool>,
    port: u16,
    token: String,
}

#[derive(Serialize)]
pub struct CollabInfo {
    url: String,
    ip: String,
    port: u16,
}

#[derive(Serialize, Clone)]
struct Inbox {
    guest: String,
    msg: String,
}

fn events_since(log: &Arc<(Mutex<Log>, Condvar)>, since: u64) -> String {
    let (lock, cvar) = &**log;
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut guard = lock.lock().unwrap();
    if since > guard.seq {
        return format!("{{\"seq\":{},\"reset\":true,\"events\":[]}}", guard.seq);
    }
    while guard.seq <= since {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        guard = cvar.wait_timeout(guard, left).unwrap().0;
    }
    let oldest = guard.events.front().map(|e| e.0).unwrap_or(guard.seq + 1);
    // Гость отстал так сильно, что журнал уже обрезан — пусть начнёт заново
    let reset = since + 1 < oldest && guard.seq > since;
    let items: Vec<&str> = guard.events.iter().filter(|e| e.0 > since).map(|e| e.1.as_str()).collect();
    format!("{{\"seq\":{},\"reset\":{},\"events\":[{}]}}", guard.seq, reset, items.join(","))
}

fn handle(mut stream: TcpStream, app: &AppHandle, token: &str, log: &Arc<(Mutex<Log>, Condvar)>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Some(req) = read_request_limited(&stream, 4 * 1024 * 1024) else { return };
    if query_param(&req.path, "k").as_deref() != Some(token) {
        respond(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", "Неверный ключ сессии".as_bytes());
        return;
    }
    let route = req.path.split('?').next().unwrap_or("/");
    match (req.method.as_str(), route) {
        ("GET", "/events") => {
            let since = query_param(&req.path, "since").and_then(|s| s.parse().ok()).unwrap_or(0);
            let body = events_since(log, since);
            respond(&mut stream, "200 OK", "application/json; charset=utf-8", body.as_bytes());
        }
        ("POST", "/send") => {
            let guest = query_param(&req.path, "g").unwrap_or_default();
            if guest.is_empty() || guest.len() > 40 || !guest.chars().all(|c| c.is_ascii_alphanumeric()) {
                respond(&mut stream, "400 Bad Request", "text/plain", b"bad guest");
                return;
            }
            let msg = String::from_utf8_lossy(&req.body).into_owned();
            let _ = app.emit("collab:inbox", Inbox { guest, msg });
            respond(&mut stream, "200 OK", "application/json", b"{\"ok\":true}");
        }
        ("GET", "/") => respond(&mut stream, "200 OK", "text/plain; charset=utf-8", "Это сессия Tulpar «Вместе по сети». Подключитесь из Tulpar: Инструменты → Вместе по сети → Подключиться.".as_bytes()),
        _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
    }
}

#[tauri::command]
pub async fn collab_start(app: AppHandle, state: State<'_, CollabState>, token: String) -> Result<CollabInfo, String> {
    if token.len() < 16 || !token.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("некорректный ключ".into());
    }
    let mut guard = state.inner.lock().map_err(|_| "состояние повреждено")?;
    if let Some(r) = guard.as_ref() {
        let ip = lan_ip();
        return Ok(CollabInfo { url: format!("http://{ip}:{}/?k={}", r.port, r.token), ip, port: r.port });
    }
    let listener = (47830..47850)
        .find_map(|p| TcpListener::bind(("0.0.0.0", p)).ok())
        .ok_or("не удалось открыть порт для совместной работы")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    {
        let mut l = state.log.0.lock().map_err(|_| "состояние повреждено")?;
        l.events.clear();
    }
    let stop = Arc::new(AtomicBool::new(false));
    let (stop2, log, tok) = (stop.clone(), state.log.clone(), token.clone());
    std::thread::spawn(move || {
        while !stop2.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let (app, tok, log) = (app.clone(), tok.clone(), log.clone());
                    std::thread::spawn(move || handle(stream, &app, &tok, &log));
                }
                Err(_) => std::thread::sleep(Duration::from_millis(50)),
            }
        }
    });
    *guard = Some(Running { stop, port, token: token.clone() });
    let ip = lan_ip();
    Ok(CollabInfo { url: format!("http://{ip}:{port}/?k={token}"), ip, port })
}

#[tauri::command]
pub async fn collab_stop(state: State<'_, CollabState>) -> Result<(), String> {
    if let Some(r) = state.inner.lock().map_err(|_| "состояние повреждено")?.take() {
        r.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Разослать гостям события (каждое — готовый JSON).
#[tauri::command]
pub async fn collab_broadcast(state: State<'_, CollabState>, messages: Vec<String>) -> Result<u64, String> {
    let (lock, cvar) = &*state.log;
    let mut l = lock.lock().map_err(|_| "состояние повреждено")?;
    for m in messages {
        if serde_json::from_str::<serde_json::Value>(&m).is_err() {
            return Err("сообщение не JSON".into());
        }
        l.seq += 1;
        let seq = l.seq;
        l.events.push_back((seq, m));
        while l.events.len() > KEEP {
            l.events.pop_front();
        }
    }
    cvar.notify_all();
    Ok(l.seq)
}
