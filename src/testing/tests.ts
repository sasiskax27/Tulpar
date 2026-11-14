// Панель «Тесты»: Tulpar сам находит, чем в проекте пишут тесты (pytest,
// Vitest, Jest, cargo, go test, Maven, Gradle, .NET), запускает их и
// показывает результаты деревом. Упавший тест можно открыть, перезапустить
// или отдать ИИ на исправление.
import { batch, createSignal } from "solid-js";
import { core, type DirEntry } from "../ipc";
import { root } from "../app/workspace";
import { notify, notifyError } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";

export type TestStatus = "passed" | "failed" | "skipped";

export interface TestCase {
  id: string;
  name: string;
  /** Группа: файл, модуль или пакет */
  group: string;
  /** Путь к файлу относительно проекта, если известен */
  file?: string;
  line?: number;
  status: TestStatus;
  message?: string;
  seconds?: number;
  /** Что передать фреймворку, чтобы запустить только этот тест */
  selector?: string;
}

export interface Framework {
  id: "pytest" | "vitest" | "jest" | "cargo" | "go" | "maven" | "gradle" | "dotnet";
  label: string;
}

const isWindows = navigator.userAgent.includes("Windows");

const [frameworks, setFrameworks] = createSignal<Framework[]>([]);
const [framework, setFramework] = createSignal<Framework | null>(null);
const [results, setResults] = createSignal<TestCase[]>([]);
const [running, setRunning] = createSignal(false);
const [rawOutput, setRawOutput] = createSignal("");
const [lastRun, setLastRun] = createSignal<{ millis: number; code: number | null; at: number } | null>(null);
export { frameworks, framework, setFramework, results, running, rawOutput, lastRun };

// ---------- поиск фреймворков ----------

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await core.readFile(path));
  } catch {
    return null;
  }
}

export async function detectFrameworks(): Promise<Framework[]> {
  const r = root();
  if (!r) {
    setFrameworks([]);
    setFramework(null);
    return [];
  }
  const sep = r.includes("\\") ? "\\" : "/";
  const entries: DirEntry[] = await core.readDir(r).catch(() => []);
  const has = (n: string) => entries.some((e) => e.name === n);
  const list: Framework[] = [];

  if (has("package.json")) {
    const pkg = await readJson(r + sep + "package.json");
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    const script = String(pkg?.scripts?.test ?? "");
    if (deps.vitest || /vitest/.test(script)) list.push({ id: "vitest", label: "Vitest" });
    else if (deps.jest || /jest/.test(script)) list.push({ id: "jest", label: "Jest" });
  }
  const pyHints = ["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini", "requirements.txt", "conftest.py", "tests", "test"];
  if (pyHints.some(has) || entries.some((e) => /^test_.*\.py$|_test\.py$/.test(e.name))) {
    // pyproject без Python-тестов бывает и у других языков — проверим, что Python тут есть
    const files = await core.listFiles().catch(() => [] as string[]);
    if (files.some((f) => f.endsWith(".py"))) list.push({ id: "pytest", label: "pytest" });
  }
  if (has("Cargo.toml")) list.push({ id: "cargo", label: "cargo test" });
  if (has("go.mod")) list.push({ id: "go", label: "go test" });
  if (has("pom.xml")) list.push({ id: "maven", label: "Maven (JUnit)" });
  if (has("build.gradle") || has("build.gradle.kts")) list.push({ id: "gradle", label: "Gradle (JUnit)" });
  if (entries.some((e) => /\.(sln|csproj|fsproj)$/i.test(e.name))) list.push({ id: "dotnet", label: ".NET" });

  setFrameworks(list);
  if (!list.some((f) => f.id === framework()?.id)) setFramework(list[0] ?? null);
  return list;
}

// ---------- команды ----------

function quote(s: string) {
  return isWindows ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`;
}

async function hasEntry(name: string) {
  const r = root();
  return !!r && (await core.readDir(r).catch(() => [])).some((e) => e.name === name);
}

/** Команда запуска и расширение отчёта. target — файл или выбранный тест. */
async function commandFor(fw: Framework, target?: { file?: string; selector?: string; name?: string }): Promise<{ cmd: string; ext?: string }> {
  const py = isWindows ? "python" : "python3";
  switch (fw.id) {
    case "pytest": {
      const what = target?.selector ?? target?.file;
      return { cmd: `${py} -m pytest -q -o junit_family=xunit1 --junitxml={report}${what ? " " + quote(what) : ""}`, ext: "xml" };
    }
    case "vitest": {
      const filter = target?.name ? ` -t ${quote(target.name)}` : "";
      return { cmd: `npx vitest run --reporter=json --outputFile={report}${target?.file ? " " + quote(target.file) : ""}${filter}`, ext: "json" };
    }
    case "jest": {
      const filter = target?.name ? ` -t ${quote(target.name)}` : "";
      return { cmd: `npx jest --json --outputFile={report}${target?.file ? " " + quote(target.file) : ""}${filter}`, ext: "json" };
    }
    case "cargo":
      return { cmd: `cargo test --no-fail-fast${target?.selector ? ` ${quote(target.selector)} -- --exact` : ""}` };
    case "go":
      return { cmd: `go test -v ${target?.selector ? `-run ${quote(`^${target.selector}$`)} ` : ""}./...` };
    case "maven": {
      const mvn = (await hasEntry(isWindows ? "mvnw.cmd" : "mvnw")) ? (isWindows ? ".\\mvnw.cmd" : "./mvnw") : "mvn";
      return { cmd: `${mvn} -q test${target?.selector ? ` -Dtest=${quote(target.selector)}` : ""}` };
    }
    case "gradle": {
      const gradle = (await hasEntry(isWindows ? "gradlew.bat" : "gradlew")) ? (isWindows ? ".\\gradlew.bat" : "./gradlew") : "gradle";
      return { cmd: `${gradle} test${target?.selector ? ` --tests ${quote(target.selector)}` : ""}` };
    }
    case "dotnet":
      return {
        cmd: `dotnet test --logger ${quote("trx;LogFileName={report}")}${target?.selector ? ` --filter ${quote(`FullyQualifiedName=${target.selector}`)}` : ""}`,
        ext: "trx",
      };
  }
}

// ---------- разбор результатов ----------

const relOf = (p: string) => {
  const r = root();
  const norm = p.replace(/\\/g, "/");
  if (r) {
    const rr = r.replace(/\\/g, "/").replace(/\/$/, "");
    if (norm.toLowerCase().startsWith(rr.toLowerCase() + "/")) return norm.slice(rr.length + 1);
  }
  return norm.replace(/^\.\//, "");
};

/** JUnit XML (pytest, Maven, Gradle). */
export function parseJUnit(xml: string, fw: Framework["id"]): TestCase[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: TestCase[] = [];
  doc.querySelectorAll("testcase").forEach((tc, i) => {
    const name = tc.getAttribute("name") ?? `test ${i + 1}`;
    const cls = tc.getAttribute("classname") ?? "";
    const fileAttr = tc.getAttribute("file") ?? undefined;
    const lineAttr = tc.getAttribute("line");
    const fail = tc.querySelector("failure, error");
    const skip = tc.querySelector("skipped");
    const status: TestStatus = fail ? "failed" : skip ? "skipped" : "passed";
    const message = fail ? [fail.getAttribute("message"), fail.textContent].filter(Boolean).join("\n").trim() : skip?.getAttribute("message") ?? undefined;
    let file = fileAttr ? relOf(fileAttr) : undefined;
    let selector: string | undefined;
    if (fw === "pytest") {
      if (!file && cls) file = cls.split(".").filter((p) => !/^[A-Z]/.test(p)).join("/") + ".py";
      const klass = cls.split(".").pop() ?? "";
      selector = file ? `${file}::${/^[A-Z]/.test(klass) ? klass + "::" : ""}${name}` : undefined;
    } else {
      selector = cls ? `${cls}${fw === "maven" ? "#" : "."}${name}` : undefined;
    }
    out.push({
      id: `${cls}::${name}::${i}`,
      name,
      group: file ?? (cls || "тесты"),
      file,
      line: lineAttr ? Number(lineAttr) + (fw === "pytest" ? 1 : 0) : undefined,
      status,
      message,
      seconds: Number(tc.getAttribute("time")) || undefined,
      selector,
    });
  });
  return out;
}

/** JSON-отчёт Jest и Vitest (формат у них общий). */
export function parseJestJson(text: string): TestCase[] {
  const data = JSON.parse(text);
  const out: TestCase[] = [];
  for (const file of data.testResults ?? []) {
    const rel = relOf(String(file.name ?? file.testFilePath ?? ""));
    const assertions = file.assertionResults ?? file.testResults ?? [];
    if (!assertions.length && file.status === "failed") {
      out.push({ id: rel, name: "файл не запустился", group: rel, file: rel, status: "failed", message: String(file.message ?? "").trim() });
    }
    assertions.forEach((a: any, i: number) => {
      const status: TestStatus = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped";
      out.push({
        id: `${rel}::${a.fullName ?? a.title}::${i}`,
        name: a.fullName ?? [...(a.ancestorTitles ?? []), a.title].join(" › "),
        group: rel,
        file: rel,
        line: a.location?.line,
        status,
        message: (a.failureMessages ?? []).join("\n").replace(/\u001b\[[0-9;]*m/g, "").trim() || undefined,
        seconds: a.duration ? a.duration / 1000 : undefined,
        selector: a.title,
      });
    });
  }
  return out;
}

/** Вывод cargo test. */
export function parseCargo(output: string): TestCase[] {
  const out: TestCase[] = [];
  const details = new Map<string, string>();
  const blocks = output.split(/\n---- /);
  for (const b of blocks.slice(1)) {
    const m = /^(\S+) stdout ----\n([\s\S]*?)(?=\n\n(?:failures:|----)|$)/.exec(b);
    if (m) details.set(m[1], m[2].trim());
  }
  for (const m of output.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)/gm)) {
    const full = m[1];
    const parts = full.split("::");
    const name = parts.pop()!;
    const status: TestStatus = m[2] === "ok" ? "passed" : m[2] === "FAILED" ? "failed" : "skipped";
    const msg = details.get(full);
    const loc = msg ? /(\S+\.rs):(\d+):\d+/.exec(msg) : null;
    out.push({
      id: full,
      name,
      group: parts.join("::") || "crate",
      file: loc ? loc[1].replace(/\\/g, "/") : undefined,
      line: loc ? Number(loc[2]) : undefined,
      status,
      message: msg,
      selector: full,
    });
  }
  return out;
}

/** Вывод go test -v. */
export function parseGo(output: string): TestCase[] {
  const out: TestCase[] = [];
  const lines = output.split(/\r?\n/);
  const logs = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines) {
    const run = /^=== (?:RUN|CONT)\s+(\S+)/.exec(line);
    if (run) {
      current = run[1];
      continue;
    }
    const res = /^\s*--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)/.exec(line);
    if (res) {
      const name = res[2];
      const log = (logs.get(name) ?? []).join("\n").trim();
      const loc = /(\S+_test\.go):(\d+)/.exec(log);
      out.push({
        id: name,
        name,
        group: name.includes("/") ? name.split("/")[0] : "go",
        file: loc?.[1],
        line: loc ? Number(loc[2]) : undefined,
        status: res[1] === "PASS" ? "passed" : res[1] === "FAIL" ? "failed" : "skipped",
        message: log || undefined,
        seconds: Number(res[3]),
        selector: name.split("/")[0],
      });
      continue;
    }
    if (current && /^\s{4}/.test(line)) logs.set(current, [...(logs.get(current) ?? []), line.trim()]);
  }
  return out;
}

/** TRX-отчёт .NET. */
export function parseTrx(xml: string): TestCase[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: TestCase[] = [];
  doc.querySelectorAll("UnitTestResult").forEach((r, i) => {
    const name = r.getAttribute("testName") ?? `test ${i + 1}`;
    const outcome = r.getAttribute("outcome") ?? "";
    const msg = r.querySelector("Message")?.textContent ?? "";
    const stack = r.querySelector("StackTrace")?.textContent ?? "";
    const loc = /in (.+?):line (\d+)/.exec(stack);
    const dot = name.lastIndexOf(".");
    out.push({
      id: `${name}::${i}`,
      name: dot > 0 ? name.slice(dot + 1) : name,
      group: dot > 0 ? name.slice(0, dot) : ".NET",
      file: loc ? relOf(loc[1]) : undefined,
      line: loc ? Number(loc[2]) : undefined,
      status: outcome === "Passed" ? "passed" : outcome === "Failed" ? "failed" : "skipped",
      message: [msg, stack].filter(Boolean).join("\n").trim() || undefined,
      selector: name,
    });
  });
  return out;
}

// ---------- запуск ----------

function missingTool(fw: Framework, output: string): boolean {
  const py = isWindows ? "python" : "python3";
  if (fw.id === "pytest" && /No module named pytest/i.test(output)) {
    notify("Для тестов Python нужен pytest. Установить?", "info", [
      { label: "Установить", run: () => void runInTerminal(`${py} -m pip install -U pytest`, "Тесты") },
    ]);
    return true;
  }
  if ((fw.id === "vitest" || fw.id === "jest") && /not recognized|not found|ENOENT|could not determine executable/i.test(output)) {
    notify("Зависимости проекта не установлены. Выполнить npm install?", "info", [
      { label: "Установить", run: () => void runInTerminal("npm install", "Тесты") },
    ]);
    return true;
  }
  return false;
}

/** Запустить тесты: все, файла или один тест. */
export async function runTests(target?: TestCase | { file: string }): Promise<void> {
  if (running()) return;
  const fw = framework() ?? (await detectFrameworks())[0];
  if (!fw) {
    notify("В проекте не нашлось тестов: pytest, Vitest, Jest, cargo, go test, Maven, Gradle или .NET");
    return;
  }
  const single = target && "status" in target ? target : undefined;
  const { cmd, ext } = await commandFor(fw, single ? { file: single.file, selector: single.selector, name: single.selector } : target);
  setRunning(true);
  setRawOutput("");
  try {
    const run = await core.testsRun(cmd, ext);
    let list: TestCase[] = [];
    try {
      if ((fw.id === "pytest" || fw.id === "maven" || fw.id === "gradle") && run.report) list = parseJUnit(run.report, fw.id);
      else if ((fw.id === "vitest" || fw.id === "jest") && run.report) list = parseJestJson(run.report);
      else if (fw.id === "dotnet" && run.report) list = parseTrx(run.report);
      else if (fw.id === "cargo") list = parseCargo(run.output);
      else if (fw.id === "go") list = parseGo(run.output);
      if (fw.id === "maven" || fw.id === "gradle") {
        const dirs = fw.id === "maven" ? ["target/surefire-reports"] : ["build/test-results/test"];
        const reports = await core.testsJunitReports(dirs);
        list = reports.flatMap((x) => parseJUnit(x, fw.id));
      }
    } catch (e) {
      notifyError("Не удалось разобрать результаты тестов", e);
    }
    batch(() => {
      setRawOutput(`$ ${cmd.replace(/\{report\}/g, "…")}\n${run.output}`);
      setLastRun({ millis: run.millis, code: run.code, at: Date.now() });
      if (single) {
        // Перезапуск одного теста — обновляем его строку, остальное оставляем
        const updated = list[0];
        setResults((prev) => (updated ? prev.map((t) => (t.id === single.id || (t.selector && t.selector === updated.selector) ? { ...updated, id: t.id } : t)) : prev));
      } else setResults(list);
    });
    if (run.timedOut) notify("Тесты остановлены: шли дольше 15 минут", "error");
    else if (!list.length && !missingTool(fw, run.output) && run.code !== 0) {
      notify("Тесты не запустились — посмотрите вывод внизу панели", "error");
    }
  } catch (e) {
    notifyError("Не удалось запустить тесты", e);
  } finally {
    setRunning(false);
  }
}

/** Запустить тесты в терминале (если хочется видеть живой вывод). */
export async function runTestsInTerminal() {
  const fw = framework();
  if (!fw) return;
  const { cmd } = await commandFor(fw);
  // В терминале отчёт не нужен
  const plain = cmd
    .replace(/ ?-o junit_family=xunit1 --junitxml=\{report\}/, "")
    .replace(/ ?--reporter=json --outputFile=\{report\}/, "")
    .replace(/ ?--json --outputFile=\{report\}/, "")
    .replace(/ ?--logger '[^']*\{report\}[^']*'/, "");
  void runInTerminal(plain, "Тесты");
}
