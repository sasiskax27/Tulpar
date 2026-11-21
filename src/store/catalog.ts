// 🏪 Магазин Tulpar: языки, серверы и базы данных, инструменты.
// Каждый пункт сам выбирает способ установки под систему: на Windows —
// портативная версия в папку Tulpar, на macOS — brew, на Linux — apt/dnf/pacman.
import { core } from "../ipc";
import { root } from "../app/workspace";
import { RUNTIMES, type RuntimeDef } from "../runtimes/runtimes";
import { ARM, OS, getJson, getText, ghAsset } from "./platform";

export type Category = "lang" | "server" | "tool" | "mobile" | "devops" | "media";

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
  /** Windows без портативной версии: установка через winget в терминале */
  winget?: string;
  /** Метки на карточке: «новое», «для Android»… */
  tags?: string[];
  /** Портативный архив подходит для всех систем (Android SDK, Gradle) */
  anyOs?: boolean;
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
  gradle: { url: "https://services.gradle.org/distributions/gradle-8.14.3-bin.zip", version: "8.14.3" },
  "android-cmdline": { url: `https://dl.google.com/android/repository/commandlinetools-${OS === "windows" ? "win" : OS}-14742923_latest.zip`, version: "14742923" },
};

/** Последний стабильный Flutter для Windows из официального списка релизов. */
async function flutterWindows() {
  const j = await getJson<{ base_url: string; current_release: { stable: string }; releases: { hash: string; version: string; archive: string }[] }>(
    "https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json",
  );
  const r = j.releases.find((x) => x.hash === j.current_release.stable);
  if (!r) throw new Error("не нашёл стабильный Flutter");
  return { url: `${j.base_url}/${r.archive}`, version: r.version };
}

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

  {
    id: "kotlin", category: "lang", icon: "🟣", title: "Kotlin", desc: "язык Android и серверов от JetBrains (нужна Java)", check: "kotlinc -version",
    windows: { resolve: () => ghAsset("JetBrains/kotlin", /^kotlin-compiler-[\d.]+\.zip$/), bins: ["bin"] },
    pkgs: { brew: "kotlin", pacman: "kotlin" },
  },
  {
    id: "dart", category: "lang", icon: "🎯", title: "Dart", desc: "язык Flutter, официальная сборка Google", check: "dart --version",
    windows: { resolve: async () => ({ url: "https://storage.googleapis.com/dart-archive/channels/stable/release/latest/sdk/dartsdk-windows-x64-release.zip", version: "stable" }), bins: ["bin"] },
    pkgs: { brew: "dart-sdk", pacman: "dart" },
  },
  {
    id: "rust", category: "lang", icon: "🦀", title: "Rust", desc: "быстрый и надёжный системный язык (rustup)", check: "cargo --version",
    winget: "Rustlang.Rustup", pkgs: { apt: "rustup", dnf: "rustup", pacman: "rustup", brew: "rustup" },
  },
  {
    id: "dotnet", category: "lang", icon: "🟪", title: ".NET SDK", desc: "C#, F#, ASP.NET, Unity-скрипты", check: "dotnet --version",
    winget: "Microsoft.DotNet.SDK.9", pkgs: { apt: "dotnet-sdk-8.0", dnf: "dotnet-sdk-8.0", pacman: "dotnet-sdk", brew: "dotnet" },
  },
  {
    id: "ruby", category: "lang", icon: "💎", title: "Ruby", desc: "Ruby и Rails", check: "ruby --version",
    winget: "RubyInstallerTeam.RubyWithDevKit.3.3", pkgs: { apt: "ruby-full", dnf: "ruby", pacman: "ruby", brew: "ruby" },
  },
  {
    id: "zig", category: "lang", icon: "⚡", title: "Zig", desc: "простой системный язык и компилятор C", check: "zig version",
    winget: "zig.zig", pkgs: { pacman: "zig", brew: "zig" },
  },
  {
    id: "lua", category: "lang", icon: "🌙", title: "Lua", desc: "лёгкий язык для скриптов и игр", check: "lua -v",
    winget: "DEVCOM.Lua", pkgs: { apt: "lua5.4", dnf: "lua", pacman: "lua", brew: "lua" },
  },
  {
    id: "cmake", category: "lang", icon: "🔺", title: "CMake", desc: "сборка проектов на C и C++", check: "cmake --version",
    windows: { resolve: () => ghAsset("Kitware/CMake", /^cmake-[\d.]+-windows-x86_64\.zip$/), bins: ["bin"] },
    pkgs: { apt: "cmake", dnf: "cmake", pacman: "cmake", brew: "cmake" },
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
  {
    id: "git", category: "tool", icon: "🌿", title: "Git", desc: "контроль версий — без него никуда", check: "git --version",
    winget: "Git.Git", pkgs: { apt: "git", dnf: "git", pacman: "git", brew: "git" },
  },
  {
    id: "fzf", category: "tool", icon: "🔍", title: "fzf", desc: "мгновенный поиск чего угодно в терминале", check: "fzf --version",
    windows: { resolve: () => ghAsset("junegunn/fzf", /^fzf-[\d.]+-windows_amd64\.zip$/), bins: [""] },
    pkgs: { apt: "fzf", dnf: "fzf", pacman: "fzf", brew: "fzf" },
  },
  {
    id: "bat", category: "tool", icon: "🦇", title: "bat", desc: "cat с подсветкой кода", check: "bat --version",
    windows: { resolve: () => ghAsset("sharkdp/bat", /^bat-v[\d.]+-x86_64-pc-windows-msvc\.zip$/), bins: [""] },
    pkgs: { apt: "bat", dnf: "bat", pacman: "bat", brew: "bat" },
  },
  {
    id: "fd", category: "tool", icon: "📂", title: "fd", desc: "быстрый поиск файлов", check: "fd --version",
    windows: { resolve: () => ghAsset("sharkdp/fd", /^fd-v[\d.]+-x86_64-pc-windows-msvc\.zip$/), bins: [""] },
    pkgs: { apt: "fd-find", dnf: "fd-find", pacman: "fd", brew: "fd" },
  },
  {
    id: "jq", category: "tool", icon: "🧾", title: "jq", desc: "разбор и фильтрация JSON в терминале", check: "jq --version",
    winget: "jqlang.jq", pkgs: { apt: "jq", dnf: "jq", pacman: "jq", brew: "jq" },
  },

  // ---------- Мобильные ----------
  {
    id: "android-cmdline", category: "mobile", icon: "🤖", title: "Android SDK", desc: "инструменты Google для сборки Android-приложений (sdkmanager, adb)", tags: ["для Android"], anyOs: true,
    windows: { resolve: async () => PINNED["android-cmdline"], bins: ["bin"] },
  },
  {
    id: "gradle", category: "mobile", icon: "🐘", title: "Gradle 8.14", desc: "сборщик Android и Java-проектов", check: "gradle --version", tags: ["для Android"], anyOs: true,
    windows: { resolve: async () => PINNED.gradle, bins: ["bin"] },
    pkgs: { brew: "gradle", pacman: "gradle" },
  },
  {
    id: "scrcpy", category: "mobile", icon: "📲", title: "scrcpy", desc: "экран телефона на компьютере — управлять мышкой и записывать видео", check: "scrcpy --version", tags: ["для Android"],
    windows: { resolve: () => ghAsset("Genymobile/scrcpy", /^scrcpy-win64-v[\d.]+\.zip$/), bins: [""] },
    pkgs: { apt: "scrcpy", dnf: "scrcpy", pacman: "scrcpy", brew: "scrcpy" },
  },
  {
    id: "flutter", category: "mobile", icon: "🦋", title: "Flutter", desc: "одно приложение сразу для Android, iOS, Windows и веба", check: "flutter --version", tags: ["большой: ~1 ГБ"],
    windows: { resolve: flutterWindows, bins: ["bin"] },
    pkgs: { brew: "--cask flutter" },
  },
  {
    id: "android-studio", category: "mobile", icon: "🧪", title: "Android Studio", desc: "большая официальная IDE от Google — если понадобится дизайнер экранов", check: "",
    winget: "Google.AndroidStudio", pkgs: { brew: "--cask android-studio" },
  },

  // ---------- DevOps ----------
  {
    id: "docker-desktop", category: "devops", icon: "🐳", title: "Docker Desktop", desc: "контейнеры на Windows и macOS", check: "docker --version",
    winget: "Docker.DockerDesktop", pkgs: { apt: "docker.io", dnf: "docker", pacman: "docker", brew: "--cask docker" },
  },
  {
    id: "kubectl", category: "devops", icon: "☸", title: "kubectl", desc: "управление Kubernetes", check: "kubectl version --client",
    winget: "Kubernetes.kubectl", pkgs: { pacman: "kubectl", brew: "kubectl" },
  },
  {
    id: "k9s", category: "devops", icon: "🐶", title: "k9s", desc: "удобная консоль для Kubernetes", check: "k9s version",
    windows: { resolve: () => ghAsset("derailed/k9s", /^k9s_Windows_amd64\.zip$/), bins: [""] },
    pkgs: { pacman: "k9s", brew: "k9s" },
  },
  {
    id: "helm", category: "devops", icon: "⎈", title: "Helm", desc: "пакеты для Kubernetes", check: "helm version",
    winget: "Helm.Helm", pkgs: { pacman: "helm", brew: "helm" },
  },
  {
    id: "terraform", category: "devops", icon: "🏗", title: "Terraform", desc: "инфраструктура как код", check: "terraform version",
    winget: "Hashicorp.Terraform", pkgs: { brew: "hashicorp/tap/terraform" },
  },
  {
    id: "cloudflared", category: "devops", icon: "☁", title: "Cloudflare Tunnel", desc: "показать свой локальный сайт всему интернету по ссылке", check: "cloudflared --version",
    winget: "Cloudflare.cloudflared", pkgs: { pacman: "cloudflared", brew: "cloudflared" },
  },

  // ---------- Медиа ----------
  {
    id: "ffmpeg", category: "media", icon: "🎞", title: "FFmpeg", desc: "конвертировать и сжимать видео и звук", check: "ffmpeg -version",
    windows: { resolve: () => ghAsset("BtbN/FFmpeg-Builds", /^ffmpeg-master-latest-win64-gpl\.zip$/), bins: ["bin"] },
    pkgs: { apt: "ffmpeg", dnf: "ffmpeg", pacman: "ffmpeg", brew: "ffmpeg" },
  },
  {
    id: "imagemagick", category: "media", icon: "🖼", title: "ImageMagick", desc: "менять размер, формат и сжимать картинки пачками", check: "magick -version",
    winget: "ImageMagick.ImageMagick", pkgs: { apt: "imagemagick", dnf: "ImageMagick", pacman: "imagemagick", brew: "imagemagick" },
  },
  {
    id: "ytdlp", category: "media", icon: "⬇", title: "yt-dlp", desc: "скачивать свои видео и звук с сайтов для монтажа", check: "yt-dlp --version",
    winget: "yt-dlp.yt-dlp", pkgs: { apt: "yt-dlp", dnf: "yt-dlp", pacman: "yt-dlp", brew: "yt-dlp" },
  },
];

/** Наборы: всё нужное для направления — одной кнопкой. */
export const BUNDLES: { id: string; icon: string; title: string; desc: string; items: string[] }[] = [
  { id: "android", icon: "📱", title: "Android-разработчик", desc: "Java, Android SDK, Gradle и scrcpy — собирать APK и ставить на телефон", items: ["java", "android-cmdline", "gradle", "scrcpy"] },
  { id: "web", icon: "🌐", title: "Веб-разработчик", desc: "Node.js, Bun, Git и GitHub CLI", items: ["node", "bun", "git", "gh"] },
  { id: "python", icon: "🐍", title: "Python и ИИ", desc: "Python, uv и Git", items: ["python", "uv", "git"] },
  { id: "backend", icon: "🗄", title: "Бэкенд", desc: "PostgreSQL, Redis, nginx и Node.js", items: ["postgres", "redis", "nginx", "node"] },
  { id: "devops", icon: "☸", title: "DevOps", desc: "Docker, kubectl, k9s, Helm и Terraform", items: ["docker-desktop", "kubectl", "k9s", "helm", "terraform"] },
  { id: "flutter", icon: "🦋", title: "Flutter", desc: "Flutter, Java и Android SDK — приложения сразу под всё", items: ["java", "android-cmdline", "flutter"] },
  { id: "terminal", icon: "⌨", title: "Мощный терминал", desc: "ripgrep, fzf, bat, fd, jq и lazygit", items: ["ripgrep", "fzf", "bat", "fd", "jq", "lazygit"] },
];

/** Обновлённые версии и ссылки из каталога на GitHub — без нового релиза Tulpar. */
export async function refreshPinned() {
  try {
    const r = await core.httpRequest({ method: "GET", url: "https://raw.githubusercontent.com/sasiskax27/Tulpar/main/store/catalog.json", headers: [], body: null, timeoutSecs: 10 });
    if (r.status !== 200) return;
    const data = JSON.parse(r.body) as { pinned?: Record<string, { url: string; version: string }> };
    for (const [k, v] of Object.entries(data.pinned ?? {})) if (v?.url?.startsWith("https://") && v.version) PINNED[k] = v;
  } catch {
    /* без интернета — встроенные версии */
  }
}

export const ARCH_NOTE = WIN && ARM ? "На Windows ARM портативные сборки x64 работают через эмуляцию." : "";
