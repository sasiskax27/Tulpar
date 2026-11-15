//! Системные сведения для Command Center, «Процессов и портов» и «Логов».
//! Только фиксированные команды ОС — никакого произвольного кода. Сырой вывод
//! разбирается во фронтенде (src/system/parse.ts), там же тесты разбора.

use std::process::Command;
use std::time::Duration;

fn cmd(program: &str, args: &[&str]) -> Command {
    let mut c = Command::new(program);
    c.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

fn output(program: &str, args: &[&str]) -> Result<String, String> {
    let out = cmd(program, args).output().map_err(|e| format!("{program}: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() && text.trim().is_empty() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(text)
}

fn powershell(script: &str) -> Result<String, String> {
    output("powershell", &["-NoProfile", "-NonInteractive", "-Command", script])
}

/// Сведения о системе. kind: overview | processes | ports | syslog.
/// Возвращает «ос:сырой вывод», чтобы фронтенд знал, какой разборщик брать.
#[tauri::command]
pub async fn sys_query(kind: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || query(&kind))
        .await
        .map_err(|e| e.to_string())?
}

fn query(kind: &str) -> Result<String, String> {
    let os = if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "mac" } else { "linux" };
    let raw = match (kind, os) {
        ("overview", "windows") => powershell(
            "$c=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;\
             $o=Get-CimInstance Win32_OperatingSystem;\
             @{cpu=$c;totalKb=$o.TotalVisibleMemorySize;freeKb=$o.FreePhysicalMemory;uptime=((Get-Date)-$o.LastBootUpTime).TotalSeconds;cores=[Environment]::ProcessorCount} | ConvertTo-Json -Compress",
        )?,
        ("overview", "linux") => {
            // Загрузка процессора: две выборки /proc/stat с разницей 300 мс
            let a = std::fs::read_to_string("/proc/stat").unwrap_or_default();
            std::thread::sleep(Duration::from_millis(300));
            let b = std::fs::read_to_string("/proc/stat").unwrap_or_default();
            let mem = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
            let up = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
            let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
            format!(
                "STAT1\n{}\nSTAT2\n{}\nMEM\n{}\nUPTIME {}\nCORES {cores}",
                a.lines().next().unwrap_or(""),
                b.lines().next().unwrap_or(""),
                mem,
                up.split_whitespace().next().unwrap_or("0")
            )
        }
        ("overview", _) => {
            let top = output("top", &["-l", "1", "-n", "0"]).unwrap_or_default();
            let mem = output("sysctl", &["-n", "hw.memsize"]).unwrap_or_default();
            let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
            format!("{top}\nMEMSIZE {}\nCORES {cores}", mem.trim())
        }
        ("processes", "windows") => powershell(
            "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress",
        )?,
        ("processes", "linux") => output("ps", &["-eo", "pid=,pcpu=,rss=,comm="])?,
        ("processes", _) => output("ps", &["-axo", "pid=,pcpu=,rss=,comm="])?,
        ("ports", "windows") => powershell(
            "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress",
        )?,
        ("ports", "linux") => output("ss", &["-ltnpH"])?,
        ("ports", _) => output("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN"])?,
        ("syslog", "windows") => powershell(
            "Get-WinEvent -LogName System,Application -MaxEvents 300 -ErrorAction SilentlyContinue | \
             Select-Object @{n='t';e={$_.TimeCreated.ToString('s')}},LevelDisplayName,ProviderName,@{n='m';e={($_.Message -split \"`n\")[0]}} | ConvertTo-Json -Compress",
        )?,
        ("syslog", "linux") => output("journalctl", &["-n", "400", "--no-pager", "-o", "short-iso"])?,
        ("syslog", _) => output("log", &["show", "--last", "10m", "--style", "compact", "--predicate", "messageType == error"])?,
        _ => return Err("неизвестный запрос".into()),
    };
    Ok(format!("{os}:{raw}"))
}

/// Завершить процесс по PID.
#[tauri::command]
pub async fn sys_kill(pid: u32) -> Result<(), String> {
    if pid <= 4 || pid == std::process::id() {
        return Err("этот процесс завершать нельзя".into());
    }
    let pid_s = pid.to_string();
    let status = if cfg!(windows) {
        cmd("taskkill", &["/PID", &pid_s, "/F"]).status()
    } else {
        cmd("kill", &["-9", &pid_s]).status()
    }
    .map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("не удалось завершить: нужны права администратора?".into()) }
}

/// Хвост лог-файла (последние ~512 КБ), который человек сам выбрал в диалоге.
/// Читаем только похожие на журналы файлы: .log, .txt, .out, .err, .jsonl.
#[tauri::command]
pub async fn sys_tail(path: String) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let p = std::path::PathBuf::from(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
    let looks_like_log = ["log", "txt", "out", "err", "jsonl"].contains(&ext.as_str()) || name.contains(".log.");
    if !looks_like_log {
        return Err("это не похоже на файл журнала (.log, .txt, .out, .err)".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
        let len = f.metadata().map_err(|e| e.to_string())?.len();
        const TAIL: u64 = 512 * 1024;
        if len > TAIL {
            f.seek(SeekFrom::Start(len - TAIL)).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&buf).into_owned();
        // Первая строка после обрезки может быть неполной
        Ok(if len > TAIL { text.split_once('\n').map(|x| x.1.to_owned()).unwrap_or(text) } else { text })
    })
    .await
    .map_err(|e| e.to_string())?
}
