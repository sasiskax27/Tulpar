// Что можно собрать в открытой папке: Android, Node, Rust, Go, Python, .NET,
// CMake, Flutter, Maven/Gradle, Makefile. Чистая логика — тестируется в node.

export type Kind = "android" | "flutter" | "node" | "rust" | "go" | "python" | "dotnet" | "cmake" | "maven" | "gradle" | "make" | "deno";

export interface Target {
  /** Уникальный id: kind:dir:action */
  id: string;
  kind: Kind;
  icon: string;
  label: string;
  /** Папка проекта (абсолютный путь) */
  dir: string;
  /** Команда для оболочки (PowerShell на Windows, sh на macOS/Linux) */
  command: string;
  /** Это запуск (а не только сборка) */
  run?: boolean;
  /** Что получилось: путь к APK, exe… — для кнопки «Показать» */
  artifact?: string;
  /** Чего не хватает на компьютере: id из магазина */
  needs?: string[];
}

export interface DirInfo {
  dir: string;
  name: string;
  files: string[];
  read: (rel: string) => Promise<string | null>;
}

const ICON: Record<Kind, string> = { android: "🤖", flutter: "🦋", node: "🟩", rust: "🦀", go: "🐹", python: "🐍", dotnet: "🟪", cmake: "🔺", maven: "☕", gradle: "🐘", make: "🛠", deno: "🦕" };

export function detect(info: DirInfo, win: boolean, pkg: Record<string, unknown> | null, extras: { pythonMain?: string; appId?: string; flutter?: boolean }): Target[] {
  const f = new Set(info.files.map((x) => x.toLowerCase()));
  const has = (n: string) => f.has(n.toLowerCase());
  const t: Target[] = [];
  const add = (kind: Kind, action: string, label: string, command: string, more: Partial<Target> = {}) =>
    t.push({ id: `${kind}:${info.dir}:${action}`, kind, icon: ICON[kind], label: `${label} · ${info.name}`, dir: info.dir, command, ...more });
  const gradlew = has(win ? "gradlew.bat" : "gradlew") ? (win ? "& .\\gradlew.bat" : "./gradlew") : "gradle";

  if (has("pubspec.yaml") && extras.flutter) {
    add("flutter", "run", "Запустить Flutter", "flutter run", { run: true, needs: ["flutter"] });
    add("flutter", "apk", "Собрать APK (Flutter)", "flutter build apk", { artifact: "build/app/outputs/flutter-apk/app-release.apk", needs: ["flutter"] });
  } else if ((has("settings.gradle.kts") || has("settings.gradle")) && has("app")) {
    add("android", "debug", "Собрать APK", `${gradlew} assembleDebug --console=plain`, { artifact: "app/build/outputs/apk/debug/app-debug.apk", needs: ["java", "android-cmdline", "gradle"] });
    add("android", "run", "Собрать и запустить на телефоне", `${gradlew} installDebug --console=plain`, { run: true, artifact: "app/build/outputs/apk/debug/app-debug.apk", needs: ["java", "android-cmdline", "gradle"] });
    add("android", "release", "Собрать для Google Play (.aab)", `${gradlew} bundleRelease --console=plain`, { artifact: "app/build/outputs/bundle/release/app-release.aab", needs: ["java", "android-cmdline", "gradle"] });
  } else if (has("build.gradle.kts") || has("build.gradle")) {
    add("gradle", "build", "Собрать (Gradle)", `${gradlew} build --console=plain`, { needs: ["java", "gradle"] });
    add("gradle", "run", "Запустить (Gradle)", `${gradlew} run --console=plain`, { run: true, needs: ["java", "gradle"] });
  }
  if (has("pom.xml")) {
    add("maven", "package", "Собрать (Maven)", "mvn -q package", { needs: ["java"] });
  }
  if (has("package.json") && pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const pm = has("bun.lockb") || has("bun.lock") ? "bun" : has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
    const runCmd = (s: string) => (pm === "npm" ? `npm run ${s}` : `${pm} run ${s}`);
    const install = !has("node_modules") ? `${pm} install` : "";
    const withInstall = (c: string) => (install ? (win ? `${install}; if ($?) { ${c} }` : `${install} && ${c}`) : c);
    const needs = pm === "bun" ? ["bun"] : ["node"];
    for (const s of ["dev", "start", "build", "test", "preview", "tauri"]) {
      if (!scripts[s]) continue;
      const label = { dev: "Запустить (dev)", start: "Запустить", build: "Собрать", test: "Тесты", preview: "Предпросмотр", tauri: "Tauri" }[s]!;
      add("node", s, label, withInstall(runCmd(s)), { run: s !== "build" && s !== "test", needs });
    }
  }
  if (has("deno.json") || has("deno.jsonc")) add("deno", "run", "Запустить (Deno)", "deno task dev", { run: true, needs: ["deno"] });
  if (has("cargo.toml")) {
    add("rust", "build", "Собрать (Rust)", "cargo build", { needs: ["rust"] });
    add("rust", "run", "Запустить (Rust)", "cargo run", { run: true, needs: ["rust"] });
    add("rust", "test", "Тесты (Rust)", "cargo test", { needs: ["rust"] });
  }
  if (has("go.mod")) {
    add("go", "build", "Собрать (Go)", "go build ./...", { needs: ["go"] });
    add("go", "run", "Запустить (Go)", "go run .", { run: true, needs: ["go"] });
  }
  if (extras.pythonMain) {
    const py = win ? "python" : "python3";
    const venv = has(".venv") ? (win ? "& .\\.venv\\Scripts\\python.exe" : "./.venv/bin/python") : py;
    if (has("requirements.txt") && !has(".venv")) add("python", "deps", "Поставить зависимости (Python)", `${py} -m pip install -r requirements.txt`, { needs: ["python"] });
    add("python", "run", `Запустить ${extras.pythonMain}`, `${venv} ${extras.pythonMain}`, { run: true, needs: ["python"] });
  }
  if (info.files.some((x) => /\.(csproj|fsproj|sln)$/i.test(x))) {
    add("dotnet", "build", "Собрать (.NET)", "dotnet build", { needs: ["dotnet"] });
    add("dotnet", "run", "Запустить (.NET)", "dotnet run", { run: true, needs: ["dotnet"] });
  }
  if (has("cmakelists.txt")) add("cmake", "build", "Собрать (CMake)", win ? "cmake -S . -B build; if ($?) { cmake --build build }" : "cmake -S . -B build && cmake --build build", { needs: ["cmake"] });
  if (has("makefile") && !win) add("make", "build", "Собрать (make)", "make");
  return t;
}

/** Главный python-файл: main.py, app.py, manage.py (runserver), или единственный .py. */
export function pythonMain(files: string[]): string | undefined {
  const lower = files.map((x) => x.toLowerCase());
  if (lower.includes("manage.py")) return "manage.py runserver";
  for (const n of ["main.py", "app.py", "run.py", "bot.py"]) if (lower.includes(n)) return files[lower.indexOf(n)];
  const py = files.filter((x) => x.endsWith(".py"));
  return py.length === 1 ? py[0] : undefined;
}

/** Строка Gradle «> Task :app:compileDebugKotlin» → понятное описание шага. */
export function gradleStep(line: string): string | null {
  const m = line.match(/^> Task :(?:[\w-]+:)?(\w+)/);
  if (!m) return null;
  const task = m[1];
  const words: [RegExp, string][] = [
    [/^compile.*Kotlin/, "Компилирую Kotlin"], [/^compile.*Java/, "Компилирую Java"], [/^merge.*Resources/, "Собираю ресурсы"],
    [/^process.*Manifest/, "Готовлю манифест"], [/^dex|^mergeDex|Dex/, "Превращаю в код для Android"], [/^package/, "Упаковываю APK"],
    [/^install/, "Ставлю на телефон"], [/^bundle/, "Собираю .aab"], [/^sign|Sign/, "Подписываю"], [/^lint/, "Проверяю код"],
    [/^check.*Aar|^check.*Duplicate/, "Проверяю библиотеки"], [/^generate/, "Генерирую файлы"],
  ];
  for (const [re, w] of words) if (re.test(task)) return w;
  return task;
}

/** Время «1 мин 5 с». */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
}
