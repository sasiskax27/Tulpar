// 🩺 Tulpar Doctor: одна кнопка проверяет, всё ли готово к работе с проектом,
// и предлагает исправить найденное.
import { core, joinPath } from "../ipc";
import { root, reloadDir } from "../app/workspace";
import { settings } from "../config/store";
import { detectManagers, type Manager } from "../packages/packages";
import { runInTerminal } from "../terminal/sessions";

export type Status = "ok" | "warn" | "fail" | "info";

export interface Check {
  id: string;
  title: string;
  status: Status;
  detail: string;
  fix?: { label: string; run: () => Promise<unknown> };
}

async function sh(cmd: string, timeoutSecs = 20): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await core.agentRun(cmd, timeoutSecs);
    return { ok: r.code === 0, out: r.output.trim() };
  } catch (e) {
    return { ok: false, out: String(e) };
  }
}

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";

const INSTALL: Record<string, string> = {
  npm: "npm install", pnpm: "pnpm install", yarn: "yarn", bun: "bun install",
  pip: "python -m venv .venv && .venv/bin/pip install -r requirements.txt",
  uv: "uv sync", poetry: "poetry install", cargo: "cargo fetch", go: "go mod download",
  maven: "mvn -q dependency:resolve", gradle: "gradle dependencies", dotnet: "dotnet restore",
  flutter: "flutter pub get", dart: "dart pub get", composer: "composer install", bundler: "bundle install",
};

const RUNTIME: Record<string, [cmd: string, name: string, url: string]> = {
  npm: ["node --version", "Node.js", "https://nodejs.org"], pnpm: ["pnpm --version", "pnpm", "https://pnpm.io"], yarn: ["yarn --version", "Yarn", "https://yarnpkg.com"],
  bun: ["bun --version", "Bun", "https://bun.sh"], pip: ["python --version", "Python", "https://python.org"], uv: ["uv --version", "uv", "https://docs.astral.sh/uv"],
  poetry: ["poetry --version", "Poetry", "https://python-poetry.org"], cargo: ["cargo --version", "Rust", "https://rustup.rs"], go: ["go version", "Go", "https://go.dev"],
  maven: ["mvn -v", "Maven", "https://maven.apache.org"], gradle: ["gradle -v", "Gradle", "https://gradle.org"], dotnet: ["dotnet --version", ".NET", "https://dotnet.microsoft.com"],
  flutter: ["flutter --version", "Flutter", "https://flutter.dev"], dart: ["dart --version", "Dart", "https://dart.dev"], composer: ["composer --version", "Composer", "https://getcomposer.org"],
  bundler: ["bundle --version", "Bundler", "https://bundler.io"],
};

export async function diagnose(onProgress: (checks: Check[]) => void): Promise<Check[]> {
  const r = root();
  const checks: Check[] = [];
  const push = (c: Check) => {
    checks.push(c);
    onProgress([...checks]);
  };
  if (!r) {
    push({ id: "folder", title: "Папка проекта", status: "fail", detail: "Откройте папку проекта" });
    return checks;
  }
  const isWin = navigator.userAgent.includes("Windows");
  const p = (rel: string) => joinPath(r, rel);

  // Git
  const git = await sh("git --version");
  if (!git.ok) push({ id: "git", title: "Git", status: "fail", detail: "Git не установлен — без него нет истории и GitHub", fix: { label: "Скачать Git", run: () => core.openUrl("https://git-scm.com/downloads") } });
  else {
    push({ id: "git", title: "Git", status: "ok", detail: firstLine(git.out) });
    const repo = await core.readFile(p(".git/HEAD")).then(() => true, () => false);
    if (!repo) push({ id: "repo", title: "Репозиторий", status: "warn", detail: "Папка ещё не под git", fix: { label: "git init", run: () => sh("git init") } });
    else push({ id: "repo", title: "Репозиторий", status: "ok", detail: "Папка под git" });
    const name = await sh("git config user.name");
    if (!name.out) push({ id: "gituser", title: "Имя для коммитов", status: "warn", detail: "Не задано — коммиты не получатся", fix: { label: "Указать", run: () => import("../commands/registry").then((m) => m.executeCommand("workbench.view.scm")) } });
  }

  // Стек
  let managers: Manager[] = [];
  try {
    managers = await detectManagers();
  } catch {
    /* нет */
  }
  if (!managers.length) push({ id: "stack", title: "Стек проекта", status: "info", detail: "Файлов зависимостей не найдено (package.json, requirements.txt, Cargo.toml…)" });
  for (const m of managers) {
    const rt = RUNTIME[m.id];
    if (rt) {
      let res = await sh(rt[0]);
      if (!res.ok && m.id === "pip" && isWin) res = await sh("py --version");
      if (!res.ok) {
        const { runtimeFor, installRuntime } = await import("../runtimes/runtimes");
        const one = runtimeFor(m.registry === "npm" ? "node" : m.registry === "pypi" ? (m.id === "uv" ? "uv" : "python") : m.id === "go" ? "go" : ["maven", "gradle"].includes(m.id) ? "java" : "");
        push({
          id: `rt-${m.id}`,
          title: rt[1],
          status: "fail",
          detail: `${rt[1]} не найден — нужен для ${m.file}`,
          fix: one ? { label: `Поставить ${one.title}`, run: () => installRuntime(one) } : { label: `Скачать ${rt[1]}`, run: () => core.openUrl(rt[2]) },
        });
      }
      else push({ id: `rt-${m.id}`, title: rt[1], status: "ok", detail: firstLine(res.out) });
    }
    // Зависимости поставлены?
    let install = INSTALL[m.id];
    if (install && isWin && m.id === "pip") install = "python -m venv .venv; .venv\\Scripts\\pip install -r requirements.txt";
    let installed = true;
    if (m.registry === "npm") installed = await core.readFile(p("node_modules/.package-lock.json")).then(() => true, async () => (await core.readDir(p("node_modules")).then((l) => l.length > 0, () => false)));
    else if (m.id === "pip") installed = await core.readDir(p(".venv")).then(() => true, async () => core.readDir(p("venv")).then(() => true, () => false));
    else if (m.id === "uv" || m.id === "poetry") installed = await core.readDir(p(".venv")).then(() => true, () => false);
    if (!installed && install)
      push({ id: `deps-${m.id}`, title: `Зависимости (${m.file})`, status: "fail", detail: "Не установлены — проект не запустится", fix: { label: install, run: () => runInTerminal(install, "Установка") } });
    else push({ id: `deps-${m.id}`, title: `Зависимости (${m.file})`, status: "ok", detail: "Установлены" });
    // Lock-файл
    if (m.registry === "npm") {
      const lock = await Promise.any(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].map((f) => core.readFile(p(f)).then(() => true))).catch(() => false);
      if (!lock) push({ id: "lock", title: "Lock-файл", status: "warn", detail: "Нет package-lock.json — у всех могут быть разные версии пакетов", fix: install ? { label: install, run: () => runInTerminal(install, "Установка") } : undefined });
    }
  }

  // Устаревшие npm-пакеты
  if (managers.some((m) => m.id === "npm")) {
    const out = await sh("npm outdated --json", 60);
    try {
      const data = JSON.parse(out.out || "{}") as Record<string, { current?: string; latest: string }>;
      const names = Object.keys(data);
      if (names.length)
        push({ id: "outdated", title: "Устаревшие пакеты", status: "warn", detail: `${names.length}: ${names.slice(0, 5).map((n) => `${n} ${data[n].current ?? "?"}→${data[n].latest}`).join(", ")}${names.length > 5 ? "…" : ""}`, fix: { label: "npm update", run: () => runInTerminal("npm update", "Обновление") } });
      else push({ id: "outdated", title: "Устаревшие пакеты", status: "ok", detail: "Всё свежее" });
    } catch {
      /* npm не ответил JSON — пропускаем */
    }
  }

  // .env
  const hasExample = await core.readFile(p(".env.example")).then(() => true, () => false);
  const hasEnv = await core.readFile(p(".env")).then(() => true, () => false);
  if (hasExample && !hasEnv)
    push({ id: "env", title: "Файл .env", status: "fail", detail: "Есть .env.example, а .env нет — программа может не найти настройки", fix: { label: "Создать .env из примера", run: async () => { await core.writeFile(p(".env"), await core.readFile(p(".env.example"))); reloadDir(r); } } });
  else if (hasEnv) push({ id: "env", title: "Файл .env", status: "ok", detail: "Есть" });

  // .gitignore
  const gi = await core.readFile(p(".gitignore")).catch(() => null);
  if (gi === null) push({ id: "gitignore", title: ".gitignore", status: "warn", detail: "Нет — в git может попасть мусор и секреты", fix: { label: "Создать", run: () => import("../editor/side").then((m) => m.showTool("generate")) } });
  else {
    const missing = [hasEnv && !/^\s*\.env\b/m.test(gi) ? ".env" : "", managers.some((m) => m.registry === "npm") && !/node_modules/.test(gi) ? "node_modules" : ""].filter(Boolean);
    if (missing.length)
      push({ id: "gitignore", title: ".gitignore", status: "fail", detail: `Не скрыто от git: ${missing.join(", ")}`, fix: { label: "Дописать", run: async () => { await core.writeFile(p(".gitignore"), gi.replace(/\n*$/, "\n") + missing.join("\n") + "\n"); } } });
    else push({ id: "gitignore", title: ".gitignore", status: "ok", detail: "В порядке" });
  }

  // ИИ
  if (String(settings()["tulpar.ai.provider"]) === "none")
    push({ id: "ai", title: "ИИ", status: "warn", detail: "Не настроен — агент, ревью и подсказки не работают", fix: { label: "Настроить", run: () => import("../app/ui").then((u) => u.openSettingsAt("ai")) } });
  else push({ id: "ai", title: "ИИ", status: "ok", detail: String(settings()["tulpar.ai.model"] || settings()["tulpar.ai.provider"]) });

  // Память проекта
  const { brain, buildBrain } = await import("../brain/brain");
  if (!brain().trim()) push({ id: "brain", title: "Project Brain", status: "info", detail: "ИИ ещё не изучил проект", fix: { label: "Изучить проект", run: () => buildBrain() } });
  else push({ id: "brain", title: "Project Brain", status: "ok", detail: "ИИ знает проект" });

  return checks;
}
