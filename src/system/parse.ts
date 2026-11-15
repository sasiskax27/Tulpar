// Разбор вывода системных команд (Rust отдаёт «ос:сырой вывод»).
// Без зависимостей от UI — проверяется тестами в node.

export interface Overview {
  cpu: number | null;
  memUsed: number;
  memTotal: number;
  uptimeSec: number;
  cores: number;
}

export interface Proc {
  pid: number;
  name: string;
  cpu: number;
  memMb: number;
}

export interface Port {
  port: number;
  address: string;
  pid: number | null;
  process: string;
}

export interface LogLine {
  time: string;
  level: "error" | "warn" | "info" | "debug";
  source: string;
  text: string;
}

export function split(raw: string): [string, string] {
  const i = raw.indexOf(":");
  return [raw.slice(0, i), raw.slice(i + 1)];
}

function asArray<T>(v: T | T[] | null | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function cpuTimes(line: string): [number, number] {
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  return [n.reduce((a, b) => a + b, 0), idle];
}

export function parseOverview(raw: string): Overview {
  const [os, text] = split(raw);
  if (os === "windows") {
    const j = JSON.parse(text || "{}");
    const total = Number(j.totalKb) * 1024;
    return { cpu: j.cpu == null ? null : Number(j.cpu), memTotal: total, memUsed: total - Number(j.freeKb) * 1024, uptimeSec: Number(j.uptime) || 0, cores: Number(j.cores) || 1 };
  }
  if (os === "linux") {
    const lines = text.split("\n");
    const s1 = lines[lines.indexOf("STAT1") + 1] ?? "";
    const s2 = lines[lines.indexOf("STAT2") + 1] ?? "";
    const [t1, i1] = cpuTimes(s1);
    const [t2, i2] = cpuTimes(s2);
    const dt = t2 - t1;
    const kb = (key: string) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
    const total = kb("MemTotal");
    return {
      cpu: dt > 0 ? Math.round((1 - (i2 - i1) / dt) * 100) : null,
      memTotal: total,
      memUsed: total - kb("MemAvailable"),
      uptimeSec: Number(text.match(/^UPTIME (\S+)/m)?.[1] ?? 0),
      cores: Number(text.match(/^CORES (\d+)/m)?.[1] ?? 1),
    };
  }
  // macOS: «CPU usage: 7.1% user, 5.2% sys, 87.6% idle», «PhysMem: 15G used (…), 1024M unused.»
  const idle = Number(text.match(/([\d.]+)% idle/)?.[1]);
  const total = Number(text.match(/^MEMSIZE (\d+)/m)?.[1] ?? 0);
  const unit = (v: string, u: string) => Number(v) * (u === "G" ? 1024 ** 3 : u === "M" ? 1024 ** 2 : 1024);
  const used = text.match(/PhysMem:\s*([\d.]+)([GMK]) used/);
  return {
    cpu: Number.isFinite(idle) ? Math.round(100 - idle) : null,
    memTotal: total,
    memUsed: used ? unit(used[1], used[2]) : 0,
    uptimeSec: 0,
    cores: Number(text.match(/^CORES (\d+)/m)?.[1] ?? 1),
  };
}

export function parseProcesses(raw: string): Proc[] {
  const [os, text] = split(raw);
  if (os === "windows") {
    // CPU в Windows — секунды процессорного времени, а не проценты; показываем как есть
    return asArray<{ Id: number; ProcessName: string; CPU: number | null; WorkingSet64: number }>(JSON.parse(text || "[]")).map((p) => ({
      pid: p.Id,
      name: p.ProcessName,
      cpu: Math.round((p.CPU ?? 0) * 10) / 10,
      memMb: Math.round(p.WorkingSet64 / 1024 / 1024),
    }));
  }
  return text
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pid: Number(m[1]), cpu: Number(m[2]), memMb: Math.round(Number(m[3]) / 1024), name: m[4].split("/").pop()! }));
}

export function parsePorts(raw: string, procs: Proc[] = []): Port[] {
  const [os, text] = split(raw);
  const nameOf = (pid: number | null) => (pid == null ? "" : procs.find((p) => p.pid === pid)?.name ?? "");
  let list: Port[] = [];
  if (os === "windows") {
    list = asArray<{ LocalAddress: string; LocalPort: number; OwningProcess: number }>(JSON.parse(text || "[]")).map((c) => ({
      port: c.LocalPort,
      address: c.LocalAddress,
      pid: c.OwningProcess,
      process: nameOf(c.OwningProcess),
    }));
  } else if (os === "linux") {
    // LISTEN 0 4096 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=812,fd=6))
    for (const line of text.split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const local = cols[3];
      const port = Number(local.slice(local.lastIndexOf(":") + 1));
      if (!port) continue;
      const user = line.match(/\("([^"]+)",pid=(\d+)/);
      list.push({ port, address: local.slice(0, local.lastIndexOf(":")), pid: user ? Number(user[2]) : null, process: user?.[1] ?? "" });
    }
  } else {
    // node 4242 user 23u IPv4 0x… 0t0 TCP *:3000 (LISTEN)
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const addr = cols.find((c) => /:\d+$/.test(c));
      if (!addr) continue;
      list.push({ port: Number(addr.slice(addr.lastIndexOf(":") + 1)), address: addr.slice(0, addr.lastIndexOf(":")), pid: Number(cols[1]) || null, process: cols[0] });
    }
  }
  // Одна строка на порт (IPv4 и IPv6 часто дублируют друг друга)
  const seen = new Set<string>();
  return list
    .filter((p) => {
      const k = `${p.port}:${p.pid}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.port - b.port);
}

export function levelOf(text: string): LogLine["level"] {
  if (/\b(error|err|fatal|critical|panic|exception|fail(ed)?|ошибк|критич)/i.test(text)) return "error";
  if (/\b(warn(ing)?|предупрежд|deprecated)/i.test(text)) return "warn";
  if (/\b(debug|trace)\b/i.test(text)) return "debug";
  return "info";
}

const WIN_LEVEL: Record<string, LogLine["level"]> = { Error: "error", Critical: "error", Warning: "warn", Ошибка: "error", Критический: "error", Предупреждение: "warn" };

export function parseSyslog(raw: string): LogLine[] {
  const [os, text] = split(raw);
  if (os === "windows") {
    return asArray<{ t: string; LevelDisplayName: string; ProviderName: string; m: string }>(JSON.parse(text || "[]")).map((e) => ({
      time: e.t,
      level: WIN_LEVEL[e.LevelDisplayName] ?? "info",
      source: e.ProviderName,
      text: (e.m ?? "").trim(),
    }));
  }
  return parseLogText(text);
}

/** Произвольный лог-файл: время в начале строки, уровень — по словам. */
export function parseLogText(text: string): LogLine[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const time = l.match(/^\[?(\d{4}-\d\d-\d\d[T ][\d:.]+[^\s\]]*|\w{3} [ \d]\d [\d:]{8})\]?/)?.[1] ?? "";
      return { time, level: levelOf(l), source: "", text: time ? l.slice(l.indexOf(time) + time.length).replace(/^[\]\s]+/, "") : l };
    });
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`;
  return `${Math.round(n / 1024 ** 2)} МБ`;
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин`;
}
