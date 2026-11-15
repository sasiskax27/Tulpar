// 🏪 Магазин Tulpar: языки, серверы и базы данных, инструменты.
// Каждый пункт сам выбирает способ установки под систему: на Windows —
// портативная версия в папку Tulpar, на macOS — brew, на Linux — apt/dnf/pacman.
import { core } from "../ipc";
import { root } from "../app/workspace";
import { RUNTIMES, type RuntimeDef } from "../runtimes/runtimes";
import { ARM, OS, getJson, getText, ghAsset } from "./platform";

export type Category = "lang" | "server" | "tool";

export interface ServiceDef {
  port: number;
  /** Где открыть в браузере (если это сайт) */
  url?: string;
  /** Строка подключения для баз данных */
  conn?: string;
  /** Windows: exe внутри папки сервера */
  exe: string;
  args: () => string[];
  /** Подготовка перед первым запуском (initdb, конфиг) */
  setup?: () => Promise<void>;
  /** Корректная остановка перед kill (nginx -s quit) */
  stop?: () => Promise<void>;
  /** macOS/Linux: имя для brew services / systemctl */
  unixService?: string;
}

export interface StoreItem {
  id: string;
  category: Category;
  icon: string;
  title: string;
  desc: string;
  /** Команда проверки «уже есть в системе» */
  check?: string;
  windows?: { resolve: () => Promise<{ url: string; version: string }>; bins: string[] };
  pkgs?: { apt?: string; dnf?: string; pacman?: string; zypper?: string; brew?: string };
  service?: ServiceDef;
  runtime?: RuntimeDef;
}

const WIN = OS === "windows";
const projectRoot = () => root() ?? ".";

async function exists(kind: string, rel: string) {
  const p = await core.servicePath(kind, rel);
  return core.readDir(p).then(() => true, () => core.readFile(p).then(() => true, () => false));
}

// Версии для пунктов без «последней версии» в API. Обновляются из каталога на GitHub (store/catalog.json).
const PINNED: Record<string, { url: string; version: string }> = {
  postgres: { url: "https://get.enterprisedb.com/postgresql/postgresql-17.2-1-windows-x64-binaries.zip", version: "17.2" },
  mysql: { url: "https://dev.mysql.com/get/Downloads/MySQL-8.4/mysql-8.4.3-winx64.zip", version: "8.4.3" },
  sqlite: { url: "https://www.sqlite.org/2024/sqlite-tools-win-x64-3470200.zip", version: "3.47.2" },
};

export const ITEMS: StoreItem[] = [
  // ---------- Языки ----------
  ...RUNTIMES.map((r): StoreItem => ({
    id: r.kind,
    category: "lang",
    icon: { python: "🐍", node: "🟩", go: "🐹", java: "☕", uv: "⚡" }[r.kind] ?? "📦",
    title: r.title,
    desc: r.note,
    check: `${r.tool} --version`,
    runtime: r,
  })),
  {
    id: "deno", category: "lang", icon: "🦕", title: "Deno", desc: "современный JavaScript/TypeScript без node_modules", check: "deno --version",
    windows: { resolve: () => ghAsset("denoland/deno", /^deno-x86_64-pc-windows-msvc\.zip$/), bins: [""] },
    pkgs: { brew: "deno" },
  },
  {
    id: "bun", category: "lang", icon: "🥟", title: "Bun", desc: "очень быстрый запуск JS/TS и менеджер пакетов", check: "bun --version",
    windows: { resolve: () => ghAsset("oven-sh/bun", /^bun-windows-x64\.zip$/), bins: [""] },
    pkgs: { brew: "oven-sh/bun/bun" },
  },
  {
    id: "php", category: "lang", icon: "🐘", title: "PHP", desc: "PHP 8 — с windows.php.net", check: "php --version",
    windows: {
      resolve: async () => {
        const rel = await getJson<Record<string, { version: string; [k: string]: unknown }>>("https://windows.php.net/downloads/releases/releases.json");
        const latest = Object.keys(rel).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
        const v = rel[latest];
        const nts = Object.entries(v).find(([k, x]) => /^nts-vs\d+-x64$/.test(k) && typeof x === "object") as [string, { zip: { path: string } }] | undefined;
        if (!nts) throw new Error("не нашёл сборку PHP");
        return { url: `https://windows.php.net/downloads/releases/${nts[1].zip.path}`, version: v.version };
      },
      bins: [""],
    },
    pkgs: { apt: "php-cli", dnf: "php-cli", pacman: "php", brew: "php" },
  },

  // ---------- Серверы и базы ----------
  {
    id: "nginx", category: "server", icon: "🌐", title: "nginx", desc: "веб-сервер: раздаёт папку проекта на http://localhost:8080", check: "nginx -v",
    windows: {
      resolve: async () => {
        const html = await getText("https://nginx.org/en/download.html");
        const stable = html.split(/Stable version/i)[1] ?? html;
        const v = /nginx-(\d+\.\d+\.\d+)\.zip/.exec(stable)?.[1];
        if (!v) throw new Error("не нашёл версию nginx");
        return { url: `https://nginx.org/download/nginx-${v}.zip`, version: v };
      },
      bins: [""],
    },
    pkgs: { apt: "nginx", dnf: "nginx", pacman: "nginx", brew: "nginx" },
    service: {
      port: 8080,
      url: "http://localhost:8080/",
      exe: "nginx.exe",
      args: () => [],
      unixService: "nginx",
      setup: async () => {
        const site = projectRoot().replace(/\\/g, "/");
        await core.serviceWriteConfig("nginx", "conf/nginx.conf", `# Создано Tulpar: раздаём папку проекта
worker_processes 1;
events { worker_connections 1024; }
http {
  include mime.types;
  default_type application/octet-stream;
  sendfile on;
  server {
    listen 8080;
    server_name localhost;
    root "${site}";
    index index.html index.htm;
    location / { try_files $uri $uri/ /index.html; }
  }
}
`);
      },
      stop: async () => {
        await core.serviceRunOnce("nginx", "nginx.exe", ["-s", "quit"]).catch(() => undefined);
      },
    },
  },
  {
    id: "caddy", category: "server", icon: "🔒", title: "Caddy", desc: "простой веб-сервер с автоматическим HTTPS — раздаёт проект на :8081", check: "caddy version",
    windows: { resolve: () => ghAsset("caddyserver/caddy", /^caddy_[\d.]+_windows_amd64\.zip$/), bins: [""] },
    pkgs: { apt: "caddy", dnf: "caddy", pacman: "caddy", brew: "caddy" },
    service: { port: 8081, url: "http://localhost:8081/", exe: "caddy.exe", args: () => ["file-server", "--root", projectRoot(), "--listen", ":8081", "--browse"], unixService: "caddy" },
  },
  {
    id: "postgres", category: "server", icon: "🐘", title: "PostgreSQL", desc: "самая популярная база данных для серьёзных проектов", check: "psql --version",
    windows: { resolve: async () => PINNED.postgres, bins: ["bin"] },
    pkgs: { apt: "postgresql", dnf: "postgresql-server", pacman: "postgresql", brew: "postgresql@17" },
    service: {
      port: 5432,
      conn: "postgresql://postgres@localhost:5432/postgres",
      exe: "bin/postgres.exe",
      args: () => ["-D", "data", "-p", "5432"],
      unixService: OS === "mac" ? "postgresql@17" : "postgresql",
      setup: async () => {
        if (await exists("postgres", "data/PG_VERSION")) return;
        const [code, out] = await core.serviceRunOnce("postgres", "bin/initdb.exe", ["-D", "data", "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"]);
        if (code !== 0) throw new Error(`initdb: ${out.slice(-300)}`);
      },
    },
  },
  {
    id: "mysql", category: "server", icon: "🐬", title: "MySQL", desc: "база данных для PHP, WordPress, Laravel", check: "mysql --version",
    windows: { resolve: async () => PINNED.mysql, bins: ["bin"] },
    pkgs: { apt: "mysql-server", dnf: "mysql-server", pacman: "mariadb", brew: "mysql" },
    service: {
      port: 3306,
      conn: "mysql://root@localhost:3306",
      exe: "bin/mysqld.exe",
      args: () => ["--datadir=data", "--basedir=.", "--port=3306", "--console"],
      unixService: OS === "mac" ? "mysql" : "mysql",
      setup: async () => {
        if (await exists("mysql", "data/mysql")) return;
        const [code, out] = await core.serviceRunOnce("mysql", "bin/mysqld.exe", ["--initialize-insecure", "--datadir=data", "--basedir=.", "--console"]);
        if (code !== 0) throw new Error(`mysqld --initialize: ${out.slice(-300)}`);
      },
    },
  },
  {
    id: "redis", category: "server", icon: "🟥", title: "Redis", desc: "быстрое хранилище в памяти: кэш, очереди, сессии", check: "redis-server --version",
    windows: { resolve: () => ghAsset("redis-windows/redis-windows", /Windows-x64.*\.zip$/i), bins: [""] },
    pkgs: { apt: "redis-server", dnf: "redis", pacman: "redis", brew: "redis" },
    service: { port: 6379, conn: "redis://localhost:6379", exe: "redis-server.exe", args: () => ["--port", "6379"], unixService: OS === "linux" ? "redis-server" : "redis" },
  },

  // ---------- Инструменты ----------
  {
    id: "gh", category: "tool", icon: "🐙", title: "GitHub CLI", desc: "вход в GitHub, публикация репозиториев и релизов", check: "gh --version",
    windows: { resolve: () => ghAsset("cli/cli", /^gh_[\d.]+_windows_amd64\.zip$/), bins: ["bin"] },
    pkgs: { apt: "gh", dnf: "gh", pacman: "github-cli", brew: "gh" },
  },
  {
    id: "sqlite", category: "tool", icon: "🪶", title: "SQLite CLI", desc: "консоль для баз .db и .sqlite", check: "sqlite3 --version",
    windows: { resolve: async () => PINNED.sqlite, bins: [""] },
    pkgs: { apt: "sqlite3", dnf: "sqlite", pacman: "sqlite", brew: "sqlite" },
  },
  {
    id: "ripgrep", category: "tool", icon: "🔎", title: "ripgrep", desc: "сверхбыстрый поиск по коду в терминале (rg)", check: "rg --version",
    windows: { resolve: () => ghAsset("BurntSushi/ripgrep", /^ripgrep-[\d.]+-x86_64-pc-windows-msvc\.zip$/), bins: [""] },
    pkgs: { apt: "ripgrep", dnf: "ripgrep", pacman: "ripgrep", brew: "ripgrep" },
  },
  {
    id: "lazygit", category: "tool", icon: "🌳", title: "lazygit", desc: "удобный git прямо в терминале", check: "lazygit --version",
    windows: { resolve: () => ghAsset("jesseduffield/lazygit", /^lazygit_[\d.]+_Windows_x86_64\.zip$/), bins: [""] },
    pkgs: { pacman: "lazygit", brew: "lazygit" },
  },
];

/** Обновлённые версии и ссылки из каталога на GitHub — без нового релиза Tulpar. */
export async function refreshPinned() {
  try {
    const r = await core.httpRequest({ method: "GET", url: "https://raw.githubusercontent.com/sasiskax41/Tulpar/main/store/catalog.json", headers: [], body: null, timeoutSecs: 10 });
    if (r.status !== 200) return;
    const data = JSON.parse(r.body) as { pinned?: Record<string, { url: string; version: string }> };
    for (const [k, v] of Object.entries(data.pinned ?? {})) if (v?.url?.startsWith("https://") && v.version) PINNED[k] = v;
  } catch {
    /* без интернета — встроенные версии */
  }
}

export const ARCH_NOTE = WIN && ARM ? "На Windows ARM портативные сборки x64 работают через эмуляцию." : "";
