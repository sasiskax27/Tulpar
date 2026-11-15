// 🖥 Серверы: список, подключение, команды, файлы, деплой, мониторинг.
import { createSignal } from "solid-js";
import { core, joinPath } from "../ipc";

export interface Server {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  key?: string;
  /** Куда заливать проект */
  deployDir?: string;
  /** Команда после заливки, например «npm ci && pm2 restart app» */
  afterDeploy?: string;
  /** Что не заливать */
  excludes?: string;
  /** Стартовая папка в файлах */
  home?: string;
}

const KEY = "tulpar.servers";

function load(): Server[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Server[];
  } catch {
    return [];
  }
}

const [servers, setServersSignal] = createSignal<Server[]>(load());
export { servers };

export function saveServers(list: Server[]) {
  setServersSignal(list);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export const target = (s: Server) => `${s.user}@${s.host}`;

/** Флаги для фоновых команд (без пароля — по ключу). */
export function sshArgs(s: Server, batch = true): string[] {
  const a = ["-p", String(s.port || 22), "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
  if (batch) a.push("-o", "BatchMode=yes");
  if (s.key?.trim()) a.push("-i", s.key.trim());
  a.push(target(s));
  return a;
}

/** Строка для интерактивного терминала (тут пароль можно ввести руками). */
export function sshCommandLine(s: Server): string {
  const parts = ["ssh", "-p", String(s.port || 22)];
  if (s.key?.trim()) parts.push("-i", `"${s.key.trim()}"`);
  parts.push(target(s));
  return parts.join(" ");
}

export const q = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;

export async function exec(s: Server, command: string, stdin?: string, timeout = 30) {
  const r = await core.sshExec(sshArgs(s), command, stdin, timeout);
  if (r.code === 255) {
    const why = /Permission denied/i.test(r.stderr)
      ? "нет входа по ключу — нажмите «Подключить ключ»"
      : /Could not resolve|Name or service not known/i.test(r.stderr)
        ? "сервер не найден — проверьте адрес"
        : /timed out|Connection refused/i.test(r.stderr)
          ? "сервер не отвечает — проверьте адрес, порт и интернет"
          : r.stderr.trim().split("\n").pop() ?? "ошибка подключения";
    throw new Error(why);
  }
  return r;
}

// ---------- Мониторинг ----------
export interface Stats {
  hostname: string;
  os: string;
  uptime: string;
  load: string;
  cpus: number;
  memTotal: number;
  memUsed: number;
  diskTotal: string;
  diskUsed: string;
  diskPct: number;
  procs: { pid: string; cpu: string; mem: string; cmd: string }[];
}

const MON = [
  "echo H:$(hostname)",
  "echo O:$( (. /etc/os-release 2>/dev/null && echo $PRETTY_NAME) || uname -sr)",
  "echo U:$(uptime -p 2>/dev/null || uptime)",
  "echo L:$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)",
  "echo C:$(nproc 2>/dev/null || echo 1)",
  "free -m 2>/dev/null | awk '/^Mem:/{print \"M:\"$2\" \"$3}'",
  "df -h / 2>/dev/null | awk 'NR==2{print \"D:\"$2\" \"$3\" \"$5}'",
  "ps -eo pid,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -6 | tail -5 | awk '{print \"P:\"$1\" \"$2\" \"$3\" \"$4}'",
].join("; ");

export async function stats(s: Server): Promise<Stats> {
  const r = await exec(s, MON, undefined, 20);
  const st: Stats = { hostname: "", os: "", uptime: "", load: "", cpus: 1, memTotal: 0, memUsed: 0, diskTotal: "", diskUsed: "", diskPct: 0, procs: [] };
  for (const line of r.stdout.split("\n")) {
    const v = line.slice(2).trim();
    switch (line.slice(0, 2)) {
      case "H:": st.hostname = v; break;
      case "O:": st.os = v; break;
      case "U:": st.uptime = v.replace(/^up /, ""); break;
      case "L:": st.load = v; break;
      case "C:": st.cpus = Number(v) || 1; break;
      case "M:": [st.memTotal, st.memUsed] = v.split(" ").map(Number); break;
      case "D:": {
        const [t, u, p] = v.split(" ");
        st.diskTotal = t; st.diskUsed = u; st.diskPct = parseInt(p) || 0;
        break;
      }
      case "P:": {
        const [pid, cpu, mem, ...cmd] = v.split(" ");
        st.procs.push({ pid, cpu, mem, cmd: cmd.join(" ") });
        break;
      }
    }
  }
  return st;
}

// ---------- Файлы ----------
export interface RemoteEntry { name: string; dir: boolean; size: number; mtime: number; link: boolean }

export async function listDir(s: Server, path: string): Promise<{ path: string; entries: RemoteEntry[] }> {
  const r = await exec(s, `cd ${q(path)} 2>/dev/null && pwd && LC_ALL=C ls -la --time-style=+%s`, undefined, 20);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "не удалось открыть папку");
  const lines = r.stdout.split("\n");
  const real = lines.shift()?.trim() || path;
  const entries: RemoteEntry[] = [];
  for (const l of lines) {
    const m = /^([dlcbsp-])\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d+)\s+(.+)$/.exec(l);
    if (!m) continue;
    let name = m[4];
    const link = m[1] === "l";
    if (link) name = name.split(" -> ")[0];
    if (name === "." || name === "..") continue;
    entries.push({ name, dir: m[1] === "d" || (link && !/\.\w+$/.test(name)), size: Number(m[2]), mtime: Number(m[3]), link });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { path: real, entries };
}

// Открытые копии файлов с серверов: локальный путь → сервер и путь там
const OPEN = "tulpar.servers.open";
function openMap(): Record<string, { id: string; remote: string }> {
  try {
    return JSON.parse(localStorage.getItem(OPEN) ?? "{}");
  } catch {
    return {};
  }
}

export async function openRemoteFile(s: Server, remote: string) {
  const r = await exec(s, `head -c 3000000 ${q(remote)}`, undefined, 60);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "не удалось прочитать файл");
  const cache = await core.sshCacheDir();
  const local = joinPath(joinPath(cache, `${s.host.replace(/[^\w.-]/g, "_")}`), remote.replace(/^\/+/, "").replace(/[<>:"|?*]/g, "_"));
  await core.agentWrite(local, r.stdout);
  const map = openMap();
  map[local.toLowerCase()] = { id: s.id, remote };
  localStorage.setItem(OPEN, JSON.stringify(map));
  const { openFile } = await import("../editor/tabs");
  await openFile(local);
}

/** Вызывается при сохранении любого файла: если это копия с сервера — заливаем обратно. */
export async function maybeUpload(localPath: string, content: string): Promise<boolean> {
  const hit = openMap()[localPath.toLowerCase()];
  if (!hit) return false;
  const s = servers().find((x) => x.id === hit.id);
  if (!s) return false;
  const { notify } = await import("../app/notify");
  try {
    const r = await exec(s, `cat > ${q(hit.remote)}`, content, 60);
    if (r.code !== 0) throw new Error(r.stderr.trim() || "нет прав на запись");
    notify(`☁ Сохранено на ${s.name}: ${hit.remote}`);
  } catch (e) {
    notify(`Не удалось сохранить на сервер: ${(e as Error).message}`, "error");
  }
  return true;
}

// ---------- Сервисы ----------
export interface Service { name: string; active: string; sub: string; description: string }

export async function services(s: Server): Promise<Service[]> {
  const r = await exec(s, "systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null | head -300", undefined, 20);
  return r.stdout
    .split("\n")
    .map((l) => /^(\S+)\.service\s+\S+\s+(\S+)\s+(\S+)\s+(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ name: m[1], active: m[2], sub: m[3], description: m[4] }));
}

export async function serviceAction(s: Server, name: string, verb: "start" | "stop" | "restart") {
  const r = await exec(s, `sudo -n systemctl ${verb} ${q(name)} 2>&1 || systemctl ${verb} ${q(name)} 2>&1`, undefined, 60);
  if (r.code !== 0) throw new Error(/password|пароль|a terminal is required/i.test(r.stdout) ? "нужен sudo с паролем — сделайте это в терминале сервера" : r.stdout.trim().slice(-200));
}

export async function serviceLogs(s: Server, name: string) {
  const r = await exec(s, `journalctl -u ${q(name)} -n 200 --no-pager 2>&1 || sudo -n journalctl -u ${q(name)} -n 200 --no-pager 2>&1`, undefined, 30);
  return r.stdout;
}

// ---------- Ключ ----------
export function keySetupCommand(s: Server): string {
  const win = navigator.userAgent.includes("Windows");
  const keyFile = win ? "$env:USERPROFILE\\.ssh\\id_ed25519" : "~/.ssh/id_ed25519";
  const remote = `"mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`;
  const port = s.port || 22;
  return win
    ? `if (!(Test-Path "${keyFile}")) { ssh-keygen -t ed25519 -N '""' -f "${keyFile}" }; Get-Content "${keyFile}.pub" | ssh -p ${port} ${target(s)} ${remote}`
    : `[ -f ${keyFile} ] || ssh-keygen -t ed25519 -N "" -f ${keyFile}; cat ${keyFile}.pub | ssh -p ${port} ${target(s)} ${remote}`;
}
