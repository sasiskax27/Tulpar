// 🔨 Встроенный сборщик: находит, что собрать, сам ставит недостающее
// (Java, Android SDK, Gradle, Node, Python, Go), собирает в своей панели,
// подсвечивает ошибки в коде и предлагает исправить их ИИ.
import { createSignal } from "solid-js";
import { core, events, joinPath, baseName } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { OS } from "../store/platform";
import { detect, duration, gradleStep, pythonMain, type Target } from "./detect";

const WIN = OS === "windows";
const BUILD_ID = "main";
const MAX_LINES = 5000;

export interface OutLine {
  text: string;
  err: boolean;
  kind?: "step" | "ok" | "fail" | "info";
}

const [targets, setTargets] = createSignal<Target[]>([]);
const [selected, setSelected] = createSignal<string>(localStorage.getItem("tulpar.build.target") ?? "");
const [lines, setLines] = createSignal<OutLine[]>([]);
const [status, setStatus] = createSignal<"idle" | "prepare" | "running" | "ok" | "fail" | "cancelled">("idle");
const [step, setStep] = createSignal("");
const [startedAt, setStartedAt] = createSignal(0);
const [lastMs, setLastMs] = createSignal(0);
const [license, setLicense] = createSignal<null | ((ok: boolean) => void)>(null);
export { targets, selected, lines, status, step, startedAt, lastMs, license };

export const current = () => targets().find((t) => t.id === selected()) ?? targets().find((t) => t.run) ?? targets()[0];

export function select(id: string) {
  setSelected(id);
  try {
    localStorage.setItem("tulpar.build.target", id);
  } catch {
    /* ignore */
  }
}

function push(text: string, err = false, kind?: OutLine["kind"]) {
  setLines((l) => {
    const next = l.length > MAX_LINES ? l.slice(-MAX_LINES / 2) : l.slice();
    next.push({ text, err, kind });
    return next;
  });
}

// ---------- поиск целей ----------

export async function refreshTargets(): Promise<Target[]> {
  const r = root();
  if (!r) {
    setTargets([]);
    return [];
  }
  const dirs = [r];
  const top = await core.readDir(r).catch(() => []);
  for (const e of top) if (e.isDir && !e.name.startsWith(".") && !["node_modules", "build", "dist", "target", "venv", ".venv"].includes(e.name)) dirs.push(e.path);
  const all: Target[] = [];
  for (const dir of dirs) {
    const list = dir === r ? top : await core.readDir(dir).catch(() => []);
    const files = list.map((e) => e.name);
    if (!files.length) continue;
    const pkgText = files.includes("package.json") ? await core.readFile(joinPath(dir, "package.json")).catch(() => null) : null;
    let pkg: Record<string, unknown> | null = null;
    try {
      pkg = pkgText ? JSON.parse(pkgText) : null;
    } catch {
      pkg = null;
    }
    const pub = files.includes("pubspec.yaml") ? await core.readFile(joinPath(dir, "pubspec.yaml")).catch(() => "") : "";
    const found = detect({ dir, name: dir === r ? baseName(r) : baseName(dir), files, read: (rel) => core.readFile(joinPath(dir, rel)).catch(() => null) }, WIN, pkg, {
      pythonMain: pythonMain(files),
      flutter: !!pub && /flutter:/m.test(pub),
    });
    all.push(...found);
  }
  setTargets(all);
  return all;
}

// ---------- недостающие инструменты ----------

async function hasTool(id: string): Promise<boolean> {
  const { installed, systemHas, refreshInstalled } = await import("../store/actions");
  const { ITEMS } = await import("../store/catalog");
  if (installed()[id] || systemHas()[id]) return true;
  await refreshInstalled(ITEMS.filter((i) => i.id === id));
  return !!(installed()[id] || systemHas()[id]);
}

/** Поставить всё, чего не хватает цели. false — не получилось или человек отказался. */
async function ensureTools(t: Target): Promise<boolean> {
  const { ITEMS } = await import("../store/catalog");
  const { install } = await import("../store/actions");
  for (const id of t.needs ?? []) {
    if (await hasTool(id)) continue;
    const item = ITEMS.find((i) => i.id === id);
    if (!item) continue;
    push(`📦 Нет ${item.title} — ставлю сам…`, false, "step");
    setStep(`Ставлю ${item.title}`);
    const ok = await install(item);
    if (!ok) {
      push(`✗ ${item.title} не поставился автоматически. Откройте Магазин → ${item.title}.`, true, "fail");
      return false;
    }
    push(`✓ ${item.title} готов`, false, "ok");
  }
  if (t.kind === "android") return ensureAndroidSdk();
  return true;
}

/** Платформа Android, build-tools и adb. Лицензию Google человек принимает сам — в окне Tulpar. */
async function ensureAndroidSdk(): Promise<boolean> {
  const a = await import("../android/android");
  const s = await a.checkSetup();
  if (s.platformTools && s.platform && s.buildTools) return true;
  const sdk = await a.sdkRoot();
  const sdkmanager = await core.servicePath("android-cmdline", `bin/sdkmanager${WIN ? ".bat" : ""}`);
  const env = { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  const cwd = await core.servicePath("android-cmdline", "");
  const accepted = await new Promise<boolean>((resolve) => setLicense(() => (ok: boolean) => { setLicense(null); resolve(ok); }));
  if (!accepted) {
    push("Без согласия с лицензией Google Android SDK не скачать. Собрать можно будет после согласия.", true, "fail");
    return false;
  }
  setStep("Принимаю лицензии Android SDK");
  // Ответ «y» на каждую лицензию — человек уже нажал «Принимаю» в окне Tulpar
  const licenses = WIN
    ? `@(1..40 | ForEach-Object { 'y' }) | ${a.exe(sdkmanager)} --sdk_root="${sdk}" --licenses`
    : `yes | ${a.exe(sdkmanager)} --sdk_root="${sdk}" --licenses`;
  if ((await runRaw(licenses, cwd, env)) !== 0) return false;
  setStep("Скачиваю платформу Android (~250 МБ)");
  push("⬇ Скачиваю платформу Android, build-tools и adb…", false, "step");
  const pkgs = ["platform-tools", `platforms;${a.PLATFORM}`, `build-tools;${a.BUILD_TOOLS}`].map((p) => `"${p}"`).join(" ");
  return (await runRaw(`${a.exe(sdkmanager)} --sdk_root="${sdk}" ${pkgs}`, cwd, env)) === 0;
}

// ---------- запуск ----------

let listening: Promise<void> | null = null;
let waiter: ((code: number | null) => void) | null = null;

function listen() {
  listening ??= (async () => {
    const { feedTerminal } = await import("../problems/problems");
    await events.onBuildLine((id, line, err) => {
      if (id !== BUILD_ID) return;
      const s = gradleStep(line);
      if (s) setStep(s);
      // sdkmanager рисует прогресс-бар одной строкой — показываем только последнюю
      if (/^\[=*\s*\]\s*\d+%/.test(line.trim())) {
        setStep(`Скачиваю… ${line.match(/(\d+)%/)?.[1] ?? ""}%`);
        return;
      }
      push(line, err);
      feedTerminal("build", line + "\n");
    });
    await events.onBuildDone((d) => {
      if (d.id !== BUILD_ID) return;
      setLastMs(d.ms);
      const w = waiter;
      waiter = null;
      w?.(d.cancelled ? null : d.code);
    });
  })();
  return listening;
}

/** Выполнить команду в панели и дождаться кода выхода. */
async function runRaw(command: string, cwd: string, env?: Record<string, string>, stdin?: string): Promise<number | null> {
  await listen();
  push(`$ ${command}`, false, "info");
  return new Promise((resolve) => {
    waiter = resolve;
    core.buildStart(BUILD_ID, cwd, command, env, stdin).catch((e) => {
      push(String(e), true, "fail");
      waiter = null;
      resolve(-1);
    });
  });
}

async function envFor(t: Target): Promise<Record<string, string>> {
  if (t.kind !== "android" && t.kind !== "flutter") return {};
  const a = await import("../android/android");
  const sdk = await a.sdkRoot();
  const env: Record<string, string> = { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  const phone = (await a.devices()).find((d) => d.state === "device");
  if (phone) env.ANDROID_SERIAL = phone.serial;
  return env;
}

/** Gradle без wrapper — берём Gradle из Tulpar, если он там есть. */
async function resolveCommand(t: Target): Promise<string> {
  if (!/^gradle /.test(t.command)) return t.command;
  const g = await core.servicePath("gradle", `bin/gradle${WIN ? ".bat" : ""}`);
  const { fileExists, exe } = await import("../android/android");
  return (await fileExists(g)) ? t.command.replace(/^gradle/, exe(g)) : t.command;
}

export async function runTarget(t: Target | undefined = current()) {
  if (!t) {
    notify("Здесь нечего собирать: откройте папку с проектом (Android, Node, Python, Rust, Go…)");
    return;
  }
  if (status() === "running" || status() === "prepare") return notify("Сборка уже идёт");
  select(t.id);
  setLines([]);
  setStep("");
  setStartedAt(Date.now());
  const { resetTerminalErrors, showProblems } = await import("../problems/problems");
  resetTerminalErrors("build");
  void import("../app/ui").then((u) => {
    u.setBottomTab("build");
    u.setBottomVisible(true);
  });
  push(`${t.icon} ${t.label}`, false, "step");

  setStatus("prepare");
  if (!(await ensureTools(t))) {
    setStatus("fail");
    return;
  }
  if (t.kind === "android") await writeLocalProperties(t.dir);

  setStatus("running");
  setStep("Запускаю…");
  const code = await runRaw(await resolveCommand(t), t.dir, await envFor(t));
  const took = duration(Date.now() - startedAt());
  if (code === null) {
    setStatus("cancelled");
    push("■ Остановлено", false, "info");
    return;
  }
  if (code !== 0) {
    setStatus("fail");
    push(`✗ Не получилось (код ${code}) за ${took}`, true, "fail");
    const { counts, fixWithAi, problems } = await import("../problems/problems");
    const errs = problems().filter((p) => p.severity === "error" && p.source?.includes("терминал"));
    notify(counts().errors ? `Сборка упала: ошибок в коде — ${counts().errors}` : "Сборка упала — подробности в панели «Сборка»", "error", [
      ...(errs.length ? [{ label: "Показать", run: showProblems }, { label: "✦ Исправить с ИИ", run: () => void fixWithAi(errs) }] : []),
      { label: "✦ Объяснить", run: () => void explainFailure() },
    ]);
    return;
  }
  setStatus("ok");
  setStep("");
  push(`✓ Готово за ${took}`, false, "ok");
  if (t.kind === "android" && t.run) await launchAndroid(t);
  notify(`✓ ${t.label}: готово за ${took}`, "info", t.artifact ? [{ label: "Показать файл", run: () => void reveal(t) }] : []);
}

export async function cancel() {
  await core.buildCancel(BUILD_ID).catch(() => {});
}

async function writeLocalProperties(dir: string) {
  const a = await import("../android/android");
  const sdk = await a.sdkRoot();
  const path = joinPath(dir, "local.properties");
  const text = (await core.readFile(path).catch(() => "")) ?? "";
  if (/^sdk\.dir=/m.test(text)) return;
  await core.writeFile(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}sdk.dir=${sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`).catch(() => {});
}

async function launchAndroid(t: Target) {
  const a = await import("../android/android");
  const p = (await a.findProjects()).find((x) => x.dir === t.dir);
  if (!p?.appId) return;
  const env = await envFor(t);
  if (!env.ANDROID_SERIAL) {
    push("Телефон не подключён — APK собран, но запускать негде. Подключите телефон или запустите эмулятор (📱 Android).", true, "info");
    return;
  }
  setStep("Открываю приложение на телефоне");
  await runRaw(`${a.exe(await a.adbPath())} shell monkey -p ${p.appId} -c android.intent.category.LAUNCHER 1`, t.dir, env);
  push("📱 Приложение открыто на телефоне", false, "ok");
}

export async function reveal(t: Target) {
  if (!t.artifact) return;
  const file = joinPath(t.dir, t.artifact);
  const dir = file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")));
  const opener = WIN ? "explorer" : OS === "mac" ? "open" : "xdg-open";
  await core.agentRun(`${opener} "${dir}"`, 15).catch(() => notify(dir));
}

export async function explainFailure() {
  const tail = lines().slice(-120).map((l) => l.text).join("\n");
  const { askAi } = await import("../tools/ai");
  push("✦ ИИ разбирает ошибку…", false, "info");
  const a = await askAi(
    "You are a build expert. A developer's build failed. Explain the real cause in simple Russian (1-3 sentences) and give exact steps or code to fix it. Ignore deprecation noise.",
    `Command: ${current()?.command}\nOutput tail:\n${tail.slice(-14000)}`,
  ).catch((e) => String(e));
  if (a) push(`✦ ${a}`, false, "info");
}

export function clear() {
  setLines([]);
  if (status() !== "running") setStatus("idle");
}
