// Отладчик. Протокол DAP (как у VS Code) поверх Content-Length «трубы»,
// которую ядро уже умеет: lsp_start/lsp_send обслуживают и языковые серверы,
// и адаптер debugpy (см. dap.ts).
//
// Порядок запуска: initialize → launch (ответ придёт позже) → событие
// initialized → setBreakpoints по каждому файлу → configurationDone.
// Программа запускается в терминале Tulpar (runInTerminal), поэтому input() работает.
import { batch, createSignal } from "solid-js";
import { baseName, core, parentDir } from "../ipc";
import { root } from "../app/workspace";
import { activePath, openFile, saveFile } from "../editor/tabs";
import { notify, notifyError } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";
import { setBottomTab, setBottomVisible } from "../app/ui";
import { DapClient } from "./dap";
import type { monaco } from "../editor/monaco";

export interface StackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
}

export interface DebugVar {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface ScopeVars {
  name: string;
  vars: DebugVar[];
}

export type DebugStatus = "off" | "starting" | "running" | "stopped" | "ended";

export interface DebugOutput {
  text: string;
  kind: "stdout" | "stderr" | "info" | "input" | "result";
}

// ---------- состояние ----------

const isWindows = navigator.userAgent.includes("Windows");
const BP_KEY = "tulpar.breakpoints";

const [status, setStatus] = createSignal<DebugStatus>("off");
const [frames, setFrames] = createSignal<StackFrame[]>([]);
const [scopes, setScopes] = createSignal<ScopeVars[]>([]);
const [output, setOutput] = createSignal<DebugOutput[]>([]);
const [pausedLine, setPausedLine] = createSignal<{ file: string; line: number } | null>(null);
const [currentFrame, setCurrentFrame] = createSignal<number | null>(null);

/** Точки останова: путь файла → строки. Сохраняются между запусками Tulpar. */
const breakpoints = new Map<string, number[]>(loadBreakpoints());
const [breakpointsVersion, setBreakpointsVersion] = createSignal(0);

export { status, frames, scopes, output, pausedLine, breakpointsVersion, currentFrame };

let client: DapClient | null = null;
let threadId: number | null = null;
let stopping = false;
let lastFile: string | null = null;

function loadBreakpoints(): [string, number[]][] {
  try {
    const raw = JSON.parse(localStorage.getItem(BP_KEY) ?? "{}") as Record<string, number[]>;
    return Object.entries(raw).filter(([, l]) => Array.isArray(l) && l.length);
  } catch {
    return [];
  }
}

function saveBreakpoints() {
  try {
    localStorage.setItem(BP_KEY, JSON.stringify(Object.fromEntries(breakpoints)));
  } catch {
    /* хранилище недоступно */
  }
}

function emitOutput(text: string, kind: DebugOutput["kind"] = "info") {
  setOutput((list) => {
    // Сливаем подряд идущие куски одного вида, чтобы не мельтешило
    const last = list[list.length - 1];
    if (last && last.kind === kind && (kind === "stdout" || kind === "stderr")) {
      return [...list.slice(0, -1), { text: last.text + text, kind }];
    }
    return [...list.slice(-1000), { text, kind }];
  });
}

export function clearOutput() {
  setOutput([]);
}

// ---------- точки останова ----------

export function breakpointLines(path: string): number[] {
  return breakpoints.get(path) ?? [];
}

/** Все файлы с точками останова — для списка в панели. */
export function breakpointFileMap(): [string, number[]][] {
  breakpointsVersion();
  return [...breakpoints.entries()];
}

export function isBreakpoint(path: string, line: number): boolean {
  return (breakpoints.get(path) ?? []).includes(line);
}

/** Задать строки точек останова файла целиком (например, после правки кода точки сдвинулись). */
export function setFileBreakpoints(path: string, lines: number[]) {
  const next = [...new Set(lines)].sort((a, b) => a - b);
  const prev = breakpoints.get(path) ?? [];
  if (prev.length === next.length && prev.every((v, i) => v === next[i])) return;
  if (next.length) breakpoints.set(path, next);
  else breakpoints.delete(path);
  saveBreakpoints();
  setBreakpointsVersion((v) => v + 1);
  if (client) void sendBreakpoints(path);
}

export function toggleBreakpoint(path: string, line: number) {
  const lines = breakpointLines(path);
  setFileBreakpoints(path, lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line]);
}

export function removeAllBreakpoints() {
  const paths = [...breakpoints.keys()];
  breakpoints.clear();
  saveBreakpoints();
  setBreakpointsVersion((v) => v + 1);
  if (client) for (const p of paths) void sendBreakpoints(p);
}

async function sendBreakpoints(path: string) {
  if (!client) return;
  const lines = breakpointLines(path);
  try {
    await client.request("setBreakpoints", {
      source: { path, name: baseName(path) },
      breakpoints: lines.map((line) => ({ line })),
      lines,
    });
  } catch (e) {
    emitOutput(`точки останова не приняты (${baseName(path)}): ${errText(e)}\n`, "stderr");
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- запуск и останов ----------

/** Python проекта: сначала виртуальное окружение (.venv, venv, env), потом системный. */
async function pythonFor(dir: string | null): Promise<string> {
  if (dir) {
    const sep = dir.includes("\\") ? "\\" : "/";
    const entries = await core.readDir(dir).catch(() => []);
    for (const venv of [".venv", "venv", "env"]) {
      if (!entries.some((e) => e.isDir && e.name === venv)) continue;
      const bin = `${dir}${sep}${venv}${sep}${isWindows ? "Scripts" : "bin"}`;
      const names = (await core.readDir(bin).catch(() => [])).map((e) => e.name);
      if (isWindows && names.includes("python.exe")) return `${bin}${sep}python.exe`;
      if (!isWindows && names.includes("python")) return `${bin}/python`;
    }
  }
  return isWindows ? "python" : "python3";
}

const quotePs = (s: string) => `'${s.replace(/'/g, "''")}'`;
const quoteSh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Команда для обратного запроса runInTerminal: программа идёт в терминале Tulpar. */
function terminalCommand(args: string[], cwd?: string, env?: Record<string, string | null>): string {
  const vars = Object.entries(env ?? {}).filter(([, v]) => v !== null) as [string, string][];
  if (isWindows) {
    return [
      cwd ? `Set-Location -LiteralPath ${quotePs(cwd)}` : "",
      ...vars.map(([k, v]) => `$env:${k}=${quotePs(v)}`),
      `& ${args.map(quotePs).join(" ")}`,
    ]
      .filter(Boolean)
      .join("; ");
  }
  const envPart = vars.map(([k, v]) => `${k}=${quoteSh(v)}`).join(" ");
  return `${cwd ? `cd ${quoteSh(cwd)} && ` : ""}${envPart ? envPart + " " : ""}${args.map(quoteSh).join(" ")}`;
}

function offerDebugpy(py: string) {
  notify("Для отладки нужен пакет debugpy. Установить?", "info", [
    { label: "Установить", run: () => void runInTerminal(`${quoteArg(py)} -m pip install -U debugpy`, "Установка debugpy") },
  ]);
}

const quoteArg = (s: string) => (/\s/.test(s) ? (isWindows ? `& ${quotePs(s)}` : quoteSh(s)) : s);

/** F5: на паузе — продолжить, иначе запустить текущий файл под отладчиком. */
export async function startOrContinue(): Promise<void> {
  if (status() === "stopped") return continueDebugging();
  if (status() === "running" || status() === "starting") return;
  return startDebugging();
}

/** Запустить текущий файл под отладчиком (Python через debugpy). */
export async function startDebugging(): Promise<void> {
  const file = activePath();
  if (!file) {
    notify("Отладка: откройте файл, который нужно запустить");
    return;
  }
  if (!/\.pyw?$/i.test(file)) {
    notify("Отладка пока работает для Python (.py). Остальные языки — «Запустить файл» (Ctrl+F5).");
    return;
  }
  if (client) await stopDebugging();
  await saveFile(file).catch(() => undefined);
  stopping = false;
  lastFile = file;
  batch(() => {
    setStatus("starting");
    setOutput([]);
    clearPauseState();
  });
  setBottomVisible(true);
  setBottomTab("debug");

  const cwd = root() ?? parentDir(file);
  const py = await pythonFor(root());
  let c: DapClient;
  try {
    c = await DapClient.start(py, ["-m", "debugpy.adapter"], cwd);
  } catch (e) {
    setStatus("ended");
    notifyError(`Не удалось запустить адаптер отладки (${py})`, e);
    return;
  }
  client = c;

  c.onExit = (stderr) => {
    if (!stopping && /No module named/.test(stderr)) offerDebugpy(py);
    else if (!stopping && stderr.trim()) emitOutput(stderr.trim().split(/\r?\n/).slice(-6).join("\n") + "\n", "stderr");
    if (client === c) endSession(false);
  };
  c.onRequest = async (command, args) => {
    if (command === "runInTerminal") {
      await runInTerminal(terminalCommand(args.args ?? [], args.cwd, args.env), "Отладка");
      // Вывод программы — в терминале, а панель отладки остаётся рядом
      setBottomTab("terminal");
      return {};
    }
    throw new Error(`не поддерживается: ${command}`);
  };
  c.onEvent = (event, body) => void onEvent(c, event, body);

  try {
    await c.request("initialize", {
      clientID: "tulpar",
      clientName: "Tulpar",
      adapterID: "debugpy",
      locale: "ru",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
      supportsRunInTerminalRequest: true,
    });
    emitOutput(`Отладка: ${file}\n`, "info");
    // debugpy отвечает на launch только после configurationDone — ответ не ждём
    c.request(
      "launch",
      {
        request: "launch",
        name: "Tulpar: запуск",
        type: "python",
        program: file,
        cwd,
        python: [py],
        console: "integratedTerminal",
        stopOnEntry: false,
        justMyCode: true,
      },
      120_000,
    ).catch((e) => {
      if (stopping || client !== c) return;
      emitOutput(`Не удалось запустить отладку: ${errText(e)}\n`, "stderr");
      notifyError("Отладка не запустилась", e);
      void stopDebugging();
    });
  } catch (e) {
    if (!stopping) {
      emitOutput(`Не удалось запустить отладку: ${errText(e)}\n`, "stderr");
      if (/debugpy|No module/i.test(errText(e))) offerDebugpy(py);
      else notifyError("Отладка не запустилась", e);
    }
    await stopDebugging();
  }
}

async function onEvent(c: DapClient, event: string, body: any) {
  if (client !== c) return;
  switch (event) {
    case "initialized":
      for (const path of [...breakpoints.keys()]) await sendBreakpoints(path);
      await c.request("setExceptionBreakpoints", { filters: ["uncaught"] }).catch(() => undefined);
      await c.request("configurationDone").catch((e) => emitOutput(`configurationDone: ${errText(e)}\n`, "stderr"));
      setStatus("running");
      break;
    case "output": {
      const text = String(body.output ?? "");
      if (!text || body.category === "telemetry") break;
      const kind: DebugOutput["kind"] = body.category === "stderr" ? "stderr" : body.category === "stdout" ? "stdout" : "info";
      if (kind !== "info" || !/^\s*$/.test(text)) emitOutput(text, kind);
      break;
    }
    case "stopped":
      await onStopped(body);
      break;
    case "continued":
      clearPauseState();
      setStatus("running");
      break;
    case "exited":
      emitOutput(`Программа завершилась, код ${body.exitCode ?? 0}.\n`, "info");
      break;
    case "terminated":
      endSession(true);
      break;
  }
}

const REASONS: Record<string, string> = {
  breakpoint: "точка останова",
  step: "шаг",
  exception: "исключение",
  pause: "пауза",
  entry: "начало программы",
};

/** Останов в точке: стек, переменные, подсветка строки. */
async function onStopped(body: { threadId?: number; reason?: string; text?: string }) {
  if (!client) return;
  setStatus("stopped");
  setBottomTab("debug");
  emitOutput(`Остановка${body.reason ? ` (${REASONS[body.reason] ?? body.reason})` : ""}\n`, "info");
  if (body.reason === "exception" && body.text) emitOutput(`${body.text}\n`, "stderr");
  try {
    if (body.threadId) threadId = body.threadId;
    else {
      const threads = (await client.request("threads")) as { threads?: { id: number }[] };
      threadId = threads.threads?.[0]?.id ?? null;
    }
    if (threadId === null) return;
    const stack = (await client.request("stackTrace", { threadId, startFrame: 0, levels: 30 })) as {
      stackFrames?: { id: number; name: string; line: number; source?: { path?: string } }[];
    };
    const list: StackFrame[] = (stack.stackFrames ?? []).map((f) => ({
      id: f.id,
      name: f.name || "(кадр)",
      file: f.source?.path ?? "",
      line: f.line,
    }));
    setFrames(list);
    const top = list.find((f) => f.file) ?? list[0];
    if (top) await selectFrame(top);
  } catch (e) {
    emitOutput(`Не удалось получить стек: ${errText(e)}\n`, "stderr");
  }
}

/** Выбрать кадр стека: открыть файл на нужной строке и показать его переменные. */
export async function selectFrame(f: StackFrame) {
  setCurrentFrame(f.id);
  if (f.file) {
    setPausedLine({ file: f.file, line: f.line });
    await openFile(f.file).catch(() => undefined);
    revealLine(f.line);
    markStoppedLine(f.line);
  }
  await loadScopes(f.id);
}

export async function loadScopes(frameId: number): Promise<void> {
  if (!client) return;
  try {
    const raw = (await client.request("scopes", { frameId })) as {
      scopes?: { name: string; variablesReference: number; expensive?: boolean }[];
    };
    const result: ScopeVars[] = [];
    for (const scope of (raw.scopes ?? []).filter((s) => s.variablesReference > 0).slice(0, 4)) {
      result.push({ name: scope.name, vars: await loadVariables(scope.variablesReference) });
    }
    setScopes(result);
  } catch (e) {
    emitOutput(`Не удалось получить переменные: ${errText(e)}\n`, "stderr");
  }
}

/** Содержимое списка, словаря или объекта (раскрытие переменной в панели). */
export async function loadVariables(ref: number): Promise<DebugVar[]> {
  if (!client || ref <= 0) return [];
  const vars = (await client
    .request("variables", { variablesReference: ref, start: 0, count: 300 })
    .catch(() => ({ variables: [] }))) as {
    variables?: { name: string; value: string; type?: string; variablesReference: number }[];
  };
  return (vars.variables ?? [])
    .filter((v) => !/^(special|function|class) variables$/.test(v.name))
    .map((v) => ({ name: v.name, value: v.value, type: v.type, variablesReference: v.variablesReference }));
}

/** Вычислить выражение в выбранном кадре (поле под выводом). */
export async function evaluate(expression: string): Promise<void> {
  const expr = expression.trim();
  if (!expr) return;
  emitOutput(`› ${expr}\n`, "input");
  if (!client || status() !== "stopped") {
    emitOutput("Вычислять можно, когда программа на паузе\n", "info");
    return;
  }
  try {
    const r = (await client.request("evaluate", { expression: expr, frameId: currentFrame() ?? undefined, context: "repl" })) as {
      result?: string;
    };
    emitOutput(`${r.result ?? ""}\n`, "result");
  } catch (e) {
    emitOutput(`${errText(e)}\n`, "stderr");
  }
}

// ---------- команды сеанса ----------

async function stepCommand(command: string, extra: Record<string, unknown> = {}) {
  if (!client || status() !== "stopped" || threadId === null) return;
  clearPauseState();
  setStatus("running");
  try {
    await client.request(command, { threadId, ...extra });
  } catch (e) {
    notifyError("Шаг не выполнен", e);
  }
}

export const continueDebugging = () => stepCommand("continue");
export const stepOver = () => stepCommand("next", { granularity: "statement" });
export const stepInto = () => stepCommand("stepIn", { granularity: "statement" });
export const stepOut = () => stepCommand("stepOut", { granularity: "statement" });

export async function pauseDebugging(): Promise<void> {
  if (!client || status() !== "running") return;
  await client.request("pause", { threadId: threadId ?? 1 }).catch(() => undefined);
}

/** Остановить отладку: вежливый disconnect, затем убить адаптер. */
export async function stopDebugging(): Promise<void> {
  stopping = true;
  const c = client;
  client = null;
  clearPauseState();
  if (c) {
    await c.request("disconnect", { terminateDebuggee: true, restart: false }, 3000).catch(() => undefined);
    await c.stop();
  }
  if (status() !== "off") setStatus("ended");
}

/** Перезапуск того же файла. */
export async function restartDebugging(): Promise<void> {
  await stopDebugging();
  if (lastFile) await openFile(lastFile).catch(() => undefined);
  await startDebugging();
}

function clearPauseState() {
  clearStopMarker();
  setPausedLine(null);
  setCurrentFrame(null);
  setFrames([]);
  setScopes([]);
}

function endSession(announce: boolean) {
  const c = client;
  client = null;
  clearPauseState();
  if (c) void c.stop();
  if (status() !== "ended" && announce) emitOutput("Отладка завершена.\n", "info");
  setStatus("ended");
}

// ---------- подсветка строк ----------

let stopDecorations: monaco.editor.IEditorDecorationsCollection | undefined;

function withEditor(fn: (editor: monaco.editor.IStandaloneCodeEditor) => void) {
  // Циклический импорт tabs → debug не нужен: берём редактор лениво.
  void import("../editor/instance").then(({ editorInstance }) => {
    const editor = editorInstance();
    if (editor) fn(editor);
  });
}

function revealLine(line: number) {
  withEditor((editor) => editor.revealLineInCenter(line));
}

function markStoppedLine(line: number) {
  withEditor((editor) => {
    stopDecorations?.clear();
    stopDecorations = editor.createDecorationsCollection([
      {
        options: { isWholeLine: true, className: "debug-stopped-line", glyphMarginClassName: "debug-stopped-arrow", zIndex: -1 },
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      },
    ]);
  });
}

export function clearStopMarker() {
  stopDecorations?.clear();
  stopDecorations = undefined;
}

/** Контекстное меню редактора: точка останова на строке с курсором. */
export function registerDebugActions(editor: monaco.editor.IStandaloneCodeEditor) {
  editor.addAction({
    id: "tulpar.debug.toggleBreakpoint",
    label: "Отладка: точка останова на этой строке",
    contextMenuGroupId: "0_tulpar_debug",
    contextMenuOrder: 0,
    run: () => {
      const pos = editor.getPosition();
      if (!pos || !activePath()) return;
      toggleBreakpoint(activePath()!, pos.lineNumber);
    },
  });
}
