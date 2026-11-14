// Задачи проекта и запуск файлов.
//
// Tulpar смотрит, какие сборщики есть в корне проекта (Maven, Gradle, npm,
// Cargo, Go, Python, Make, CMake, .NET…), и предлагает их задачи: собрать,
// проверить, запустить. Плюс ▶ — запуск текущего файла на его языке.
// Всё выполняется во встроенном терминале, вкладка «Задача».
import { core, baseName, parentDir, type DirEntry } from "../ipc";
import { root } from "../app/workspace";
import { settings } from "../config/store";
import { activePath, tabs, saveFile } from "../editor/tabs";
import { runInTerminal } from "../terminal/sessions";
import { pick } from "../app/QuickPick";
import { notify } from "../app/notify";

export interface ProjectTask {
  label: string;
  command: string;
  source: string;
  group: "build" | "test" | "run" | "other";
}

const isWindows = navigator.userAgent.includes("Windows");

// ---------- оболочка: как склеивать команды и экранировать пути ----------

function shellKind(): "powershell" | "cmd" | "posix" {
  const custom = (settings()["terminal.integrated.shell"] ?? "").toLowerCase();
  if (!isWindows) return custom.includes("pwsh") || custom.includes("powershell") ? "powershell" : "posix";
  if (custom.includes("cmd")) return "cmd";
  if (custom.includes("bash") || custom.includes("wsl")) return "posix";
  return "powershell"; // по умолчанию на Windows — PowerShell
}

/** «a, потом b, если a успешно». В Windows PowerShell 5.1 нет «&&». */
function andThen(a: string, b: string): string {
  return shellKind() === "powershell" ? `${a}; if ($?) { ${b} }` : `${a} && ${b}`;
}

function q(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

/** Запуск программы по пути: в PowerShell нужен оператор «&». */
function exec(path: string): string {
  return shellKind() === "powershell" ? `& ${q(path)}` : q(path);
}

/** Скрипт-обёртка в корне проекта: ./gradlew, ./mvnw. */
function wrapper(name: string): string {
  if (isWindows && shellKind() !== "posix") return shellKind() === "powershell" ? `.\\${name}.bat` : `${name}.bat`;
  return `./${name}`;
}

// ---------- распознавание проекта ----------

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await core.readFile(path));
  } catch {
    return null;
  }
}

function join(dir: string, name: string) {
  return dir + (dir.includes("\\") ? "\\" : "/") + name;
}

export async function detectTasks(): Promise<ProjectTask[]> {
  const r = root();
  if (!r) return [];
  let entries: DirEntry[];
  try {
    entries = await core.readDir(r);
  } catch {
    return [];
  }
  const has = (name: string) => entries.some((e) => e.name === name);
  const hasExt = (ext: string) => entries.some((e) => !e.isDir && e.name.toLowerCase().endsWith(ext));
  const tasks: ProjectTask[] = [];
  const add = (source: string, group: ProjectTask["group"], label: string, command: string) =>
    tasks.push({ source, group, label, command });

  // Maven
  if (has("pom.xml")) {
    const mvn = has("mvnw") || has("mvnw.cmd") ? (isWindows && shellKind() !== "posix" ? (shellKind() === "powershell" ? ".\\mvnw.cmd" : "mvnw.cmd") : "./mvnw") : "mvn";
    add("Maven", "build", "Собрать (compile)", `${mvn} compile`);
    add("Maven", "test", "Тесты (test)", `${mvn} test`);
    add("Maven", "build", "Упаковать (package)", `${mvn} package`);
    add("Maven", "build", "Установить в локальный репозиторий (install)", `${mvn} install`);
    add("Maven", "other", "Очистить (clean)", `${mvn} clean`);
    add("Maven", "run", "Запустить (exec:java)", `${mvn} compile exec:java`);
  }

  // Gradle
  if (has("build.gradle") || has("build.gradle.kts") || has("settings.gradle") || has("settings.gradle.kts")) {
    const gradle = has("gradlew") || has("gradlew.bat") ? wrapper("gradlew") : "gradle";
    add("Gradle", "build", "Собрать (build)", `${gradle} build`);
    add("Gradle", "test", "Тесты (test)", `${gradle} test`);
    add("Gradle", "run", "Запустить (run)", `${gradle} run`);
    add("Gradle", "other", "Очистить (clean)", `${gradle} clean`);
    add("Gradle", "other", "Список задач (tasks)", `${gradle} tasks`);
  }

  // npm / pnpm / yarn / bun — скрипты из package.json
  if (has("package.json")) {
    const pkg = await readJson(join(r, "package.json"));
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    const runCmd = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);
    add(pm, "build", "Установить зависимости", `${pm} install`);
    for (const script of Object.keys(pkg?.scripts ?? {})) {
      const group = /test/.test(script) ? "test" : /build|compile/.test(script) ? "build" : /dev|start|serve|preview/.test(script) ? "run" : "other";
      add(pm, group, script, runCmd(script));
    }
  }

  // Rust
  if (has("Cargo.toml")) {
    add("Cargo", "build", "Собрать (build)", "cargo build");
    add("Cargo", "build", "Проверить (check)", "cargo check");
    add("Cargo", "run", "Запустить (run)", "cargo run");
    add("Cargo", "test", "Тесты (test)", "cargo test");
    add("Cargo", "build", "Собрать релиз (build --release)", "cargo build --release");
    add("Cargo", "other", "Clippy — подсказки по коду", "cargo clippy");
    add("Cargo", "other", "Форматировать (fmt)", "cargo fmt");
  }

  // Go
  if (has("go.mod")) {
    add("Go", "build", "Собрать (build)", "go build ./...");
    add("Go", "run", "Запустить (run .)", "go run .");
    add("Go", "test", "Тесты (test)", "go test ./...");
    add("Go", "other", "Проверить (vet)", "go vet ./...");
    add("Go", "other", "Привести зависимости (mod tidy)", "go mod tidy");
  }

  // Python
  const py = isWindows ? "python" : "python3";
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py") || has("Pipfile")) {
    if (has("poetry.lock")) {
      add("Poetry", "build", "Установить зависимости", "poetry install");
      add("Poetry", "test", "Тесты (pytest)", "poetry run pytest");
    } else if (has("uv.lock")) {
      add("uv", "build", "Установить зависимости", "uv sync");
      add("uv", "test", "Тесты (pytest)", "uv run pytest");
    } else {
      if (has("requirements.txt")) add("Python", "build", "Установить зависимости", `${py} -m pip install -r requirements.txt`);
      if (has("pyproject.toml") || has("setup.py")) add("Python", "build", "Установить проект", `${py} -m pip install -e .`);
      add("Python", "test", "Тесты (pytest)", `${py} -m pytest`);
    }
    for (const main of ["main.py", "app.py", "manage.py"]) {
      if (has(main)) add("Python", "run", `Запустить ${main}`, main === "manage.py" ? `${py} manage.py runserver` : `${py} ${main}`);
    }
  }

  // Make
  if (has("Makefile") || has("makefile")) {
    const text = await core.readFile(join(r, has("Makefile") ? "Makefile" : "makefile")).catch(() => "");
    const targets = [...text.matchAll(/^([A-Za-z0-9][\w.-]*)\s*:(?!=)/gm)].map((m) => m[1]).filter((t) => !t.startsWith("."));
    add("Make", "build", "make", "make");
    for (const t of [...new Set(targets)].slice(0, 30)) {
      add("Make", t === "test" ? "test" : t === "run" ? "run" : "build", `make ${t}`, `make ${t}`);
    }
  }

  // CMake
  if (has("CMakeLists.txt")) {
    add("CMake", "build", "Настроить (configure)", "cmake -S . -B build");
    add("CMake", "build", "Собрать (build)", andThen("cmake -S . -B build", "cmake --build build"));
    add("CMake", "test", "Тесты (ctest)", "ctest --test-dir build");
  }

  // .NET
  if (hasExt(".sln") || hasExt(".csproj") || hasExt(".fsproj")) {
    add(".NET", "build", "Собрать (build)", "dotnet build");
    add(".NET", "run", "Запустить (run)", "dotnet run");
    add(".NET", "test", "Тесты (test)", "dotnet test");
    add(".NET", "other", "Восстановить пакеты (restore)", "dotnet restore");
  }

  // Docker
  if (has("docker-compose.yml") || has("docker-compose.yaml") || has("compose.yml") || has("compose.yaml")) {
    add("Docker", "run", "Поднять (compose up)", "docker compose up");
    add("Docker", "other", "Остановить (compose down)", "docker compose down");
  } else if (has("Dockerfile")) {
    add("Docker", "build", "Собрать образ", `docker build -t ${baseName(r).toLowerCase().replace(/[^a-z0-9_.-]/g, "-")} .`);
  }

  // Ruby, PHP, Dart/Flutter, Elixir
  if (has("Gemfile")) add("Bundler", "build", "Установить зависимости", "bundle install");
  if (has("composer.json")) add("Composer", "build", "Установить зависимости", "composer install");
  if (has("pubspec.yaml")) {
    const flutter = (await core.readFile(join(r, "pubspec.yaml")).catch(() => "")).includes("flutter:");
    const tool = flutter ? "flutter" : "dart";
    add(flutter ? "Flutter" : "Dart", "build", "Получить пакеты (pub get)", `${tool} pub get`);
    add(flutter ? "Flutter" : "Dart", "run", "Запустить (run)", `${tool} run`);
    add(flutter ? "Flutter" : "Dart", "test", "Тесты (test)", `${tool} test`);
  }
  if (has("mix.exs")) {
    add("Mix", "build", "Собрать (compile)", "mix compile");
    add("Mix", "test", "Тесты (test)", "mix test");
  }

  return tasks;
}

// ---------- запуск текущего файла ----------

/** Команда запуска файла по его языку. null — язык не умеем запускать. */
export function runFileCommand(path: string, languageId: string): string | null {
  const file = q(path);
  const dir = parentDir(path);
  const name = baseName(path);
  const stem = name.replace(/\.[^.]+$/, "");
  const exe = join(dir, isWindows ? `${stem}.exe` : stem);
  const py = isWindows ? "python" : "python3";
  switch (languageId) {
    case "python": return `${py} ${file}`;
    case "javascript": return `node ${file}`;
    case "typescript": return `npx tsx ${file}`;
    case "go": return `go run ${file}`;
    case "rust": return andThen(`rustc ${file} -o ${q(exe)}`, exec(exe));
    case "c": return andThen(`gcc ${file} -o ${q(exe)}`, exec(exe));
    case "cpp": return andThen(`g++ -std=c++20 ${file} -o ${q(exe)}`, exec(exe));
    case "java": return `java ${file}`;
    case "kotlin": return name.endsWith(".kts") ? `kotlinc -script ${file}` : andThen(`kotlinc ${file} -include-runtime -d ${q(join(dir, stem + ".jar"))}`, `java -jar ${q(join(dir, stem + ".jar"))}`);
    case "csharp": return `dotnet run`;
    case "php": return `php ${file}`;
    case "ruby": return `ruby ${file}`;
    case "lua": return `lua ${file}`;
    case "perl": return `perl ${file}`;
    case "r": return `Rscript ${file}`;
    case "julia": return `julia ${file}`;
    case "dart": return `dart run ${file}`;
    case "swift": return `swift ${file}`;
    case "scala": return `scala run ${file}`;
    case "shell": return `bash ${file}`;
    case "powershell": return isWindows ? `powershell -ExecutionPolicy Bypass -File ${file}` : `pwsh -File ${file}`;
    case "bat": return isWindows ? exec(path) : null;
    case "elixir": return `elixir ${file}`;
    case "fsharp": return `dotnet fsi ${file}`;
    case "html": return isWindows ? `start "" ${file}` : navigator.userAgent.includes("Mac") ? `open ${file}` : `xdg-open ${file}`;
    default: return null;
  }
}

export async function runCurrentFile() {
  const path = activePath();
  const tab = tabs.find((t) => t.path === path);
  if (!path || !tab || tab.diffOf) {
    notify("Откройте файл, который хотите запустить");
    return;
  }
  const command = runFileCommand(path, tab.languageId);
  if (!command) {
    notify(`Запуск файлов этого типа пока не поддерживается. Попробуйте «Задачи проекта» (Ctrl+Shift+B).`);
    return;
  }
  if (tab.dirty) await saveFile(path);
  await runInTerminal(command, "Запуск");
}

export async function runTask(groupFilter?: ProjectTask["group"]) {
  if (!root()) {
    notify("Сначала откройте папку проекта");
    return;
  }
  const all = await detectTasks();
  const list = groupFilter ? all.filter((t) => t.group === groupFilter) : all;
  if (!list.length) {
    notify(
      all.length
        ? "Таких задач в проекте нет"
        : "В корне проекта не найден сборщик (Maven, Gradle, npm, Cargo, Go, Python, Make, CMake, .NET…)",
    );
    return;
  }
  const icon = { build: "⚙", test: "✔", run: "▶", other: "•" } as const;
  const choice = await pick(
    list.map((t) => ({ label: `${icon[t.group]}  ${t.source}: ${t.label}`, detail: t.command, value: t })),
    "Задача проекта",
  );
  if (!choice) return;
  // Перед сборкой сохраняем всё — иначе соберётся старая версия
  for (const t of tabs) if (t.dirty && !t.diffOf) await saveFile(t.path);
  await runInTerminal(choice.command, "Задача");
}
