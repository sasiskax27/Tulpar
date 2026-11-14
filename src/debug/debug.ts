// Отладчик. Протокол DAP (как у VS Code) поверх Content-Length «трубы»,
// которую ядро уже умеет: lsp_start/lsp_send обслуживают и языковые серверы,
// и адаптер debugpy. Весь Python-специфичный минимум — только launch-аргументы.
//
// Порядок запуска: initialize → (ответ) → launch → событие initialized →
// setBreakpoints по каждому файлу → configurationDone.
import { createSignal } from "solid-js";
import { baseName, core, events, parentDir } from "../ipc";
import { root } from "../app/workspace";
import { activePath, openFile } from "../editor/tabs";
import { notify, notifyError } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";
import { setBottomTab, setBottomVisible } from "../app/ui";
import type { monaco } from "../editor/monaco";

// ---------- интерфейсы DAP, которые используем ----------

interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  args?: unknown;
  request_seq?: number;
  success?: boolean;
  message?: string;
  event?: string;
  body?: unknown;
}

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
  kind: "stdout" | "stderr" | "info";
}

// ---------- состояние ----------

const [status, setStatus] = createSignal<DebugStatus>("off");
const [frames, setFrames] = createSignal<StackFrame[]>([]);
const [scopes, setScopes] = createSignal<ScopeVars[]>([]);
const [output, setOutput] = createSignal<DebugOutput[]>([]);
const [pausedLine, setPausedLine] = createSignal<{ file: string; line: number } | null>(null);

/** Точки останова: путь файла → строки. */
const breakpoints = new Map<string, number[]>();
const [breakpointsVersion, setBreakpointsVersion] = createSignal(0);

export { status, frames, scopes, output, pausedLine, breakpointsVersion };

let adapterId: number | null = null;
let seq = 1;
const pending = new Map<number, { ok: (body: unknown) => void; fail: (e: string) => void }>();
let stopping = false;

// ---------- служебное ----------

function pythonCommand(): string {
  return navigator.userAgent.includes("Windows") ? "python" : "python3";
}

function emitOutput(text: string, kind: DebugOutput["kind"] = "info") {
  setOutput((list) => {
    // Сливаем подряд идущие куски одного вида, чтобы не мельтешило
    const last = list[list.length - 1];
    if (last && last.kind === kind && kind !== "info") {
      return [...list.slice(0, -1), { text: last.text + text, kind }];
    }
    return [...list, { text, kind }];
  });
}

function request(command: string, args?: unknown, timeoutMs = 15000): Promise<unknown> {
  if (adapterId === null) return Promise.reject("отладчик не запущен");
  const requestSeq = seq++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestSeq);
      reject(`нет ответа на ${command}`);
    }, timeoutMs);
    pending.set(requestSeq, {
      ok: (body) => {
        clearTimeout(timer);
        resolve(body);
      },
      fail: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    const message: DapMessage = { seq: seq++, type: "request", command, args: args ?? {} };
    void core.lspSend(adapterId!, JSON.stringify(message)).catch((e) => {
      clearTimeout(timer);
      pending.delete(requestSeq);
      reject(String(e));
    });
  });
}

function handle(raw: string) {
  let msg: DapMessage;
  try {
    msg = JSON.parse(raw) as DapMessage;
  } catch {
    return;
  }
  if (msg.type === "response" && msg.request_seq !== undefined) {
    const waiter = pending.get(msg.request_seq);
    if (waiter) {
      pending.delete(msg.request_seq);
      if (msg.success) waiter.ok(msg.body);
      else waiter.fail(msg.message ?? "ошибка отладчика");
    }
    return;
  }
  if (msg.type !== "event") return;
  switch (msg.event) {
    case "output": {
      const body = msg.body as { output?: string; category?: string };
      const text = body.output ?? "";
      if (!text) break;
      const kind: DebugOutput["kind"] = body.category === "stderr" ? "stderr" : body.category === "stdout" ? "stdout" : "info";
      if (kind !== "info" || !/^\s*$/.test(text)) emitOutput(text, kind);
      break;
    }
    case "stopped":
      void onStopped(msg.body as { threadId?: number; reason?: string });
      break;
    case "continued":
      setPausedLine(null);
      setFrames([]);
      setScopes([]);
      setStatus("running");
      clearStopMarker();
      break;
    case "terminated":
    case "exited":
      endSession();
      break;
    case "process":
      // ничего: launch уже отправлен
      break;
    case "initialized":
      void afterInitialized();
      break;
  }
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

export function toggleBreakpoint(path: string, line: number) {
  const lines = breakpoints.get(path) ?? [];
  const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b);
  if (next.length) breakpoints.set(path, next);
  else breakpoints.delete(path);
  setBreakpointsVersion((v) => v + 1);
  if (adapterId !== null) void sendBreakpoints(path);
}

async function sendBreakpoints(path: string) {
  const lines = breakpointLines(path);
  try {
    await request("setBreakpoints", {
      source: { path, name: baseName(path) },
      breakpoints: lines.map((line) => ({ line })),
      lines,
    });
  } catch (e) {
    emitOutput(`точки останова не приняты (${baseName(path)}): ${e}`, "stderr");
  }
}

// ---------- запуск и останов ----------

/** Запустить текущий файл под отладчиком (Python через debugpy). */
export async function startDebugging(): Promise<void> {
  const file = activePath();
  if (!file) {
    notify("Отладка: откройте файл, который нужно запустить");
    return;
  }
  if (adapterId !== null) await stopDebugging();
  stopping = false;
  setStatus("starting");
  setOutput([]);
  setFrames([]);
  setScopes([]);
  setPausedLine(null);
  setBottomVisible(true);
  setBottomTab("debug");

  const cwd = root() ?? parentDir(file);
  let id: number;
  try {
    id = await core.lspStart(pythonCommand(), ["-m", "debugpy.adapter"], cwd);
  } catch (e) {
    setStatus("ended");
    notifyError(`Не удалось запустить адаптер отладки (${pythonCommand()})`, e);
    return;
  }
  adapterId = id;
  unlistenMessage = await events.onLspMessage((id, message) => {
    if (id === adapterId) handle(message);
  });
  unlistenExit = await events.onLspExit((id, stderr) => {
    if (id !== adapterId) return;
    if (!stopping && /No module named/.test(stderr)) {
      notify("Для отладки нужен пакет debugpy. Установить?", "info", [
        { label: "Установить", run: () => void runInTerminal("pip install -U debugpy", "Установка debugpy") },
      ]);
    }
    adapterId = null;
    setStatus("ended");
  });

  try {
    await request("initialize", {
      adapterID: "debugpy",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
    });
    await request("launch", {
      request: "launch",
      name: "Tulpar: запуск",
      type: "python",
      program: file,
      cwd,
      console: "internalConsole",
      stopOnEntry: false,
      justMyCode: true,
      redirectOutput: true,
    });
    setStatus("running");
    emitOutput(`Отладка: ${file}\n`, "info");
  } catch (e) {
    emitOutput(`Не удалось запустить отладку: ${e}\n`, "stderr");
    notifyError("Отладка не запустилась", e);
    await stopDebugging();
  }
}

let unlistenMessage: (() => void) | undefined;
let unlistenExit: (() => void) | undefined;

/** Отписаться от событий адаптера (вызывается при завершении сеанса). */
function detachAdapterEvents() {
  unlistenMessage?.();
  unlistenExit?.();
  unlistenMessage = undefined;
  unlistenExit = undefined;
}

async function afterInitialized() {
  for (const path of [...breakpoints.keys()]) await sendBreakpoints(path);
  try {
    await request("configurationDone");
  } catch (e) {
    emitOutput(`configurationDone: ${e}`, "stderr");
  }
}

/** Останов в точке: стек, переменные, подсветка строки. */
async function onStopped(body: { threadId?: number; reason?: string }) {
  setStatus("stopped");
  emitOutput(`Остановка${body.reason ? ` (${body.reason})` : ""}\n`, "info");
  try {
    const threads = (await request("threads")) as { threads?: { id: number; name?: string }[] };
    const threadId = body.threadId ?? threads.threads?.[0]?.id;
    if (!threadId) return;
    const stack = (await request("stackTrace", { threadId, startFrame: 0, levels: 20 })) as {
      stackFrames?: { id: number; name: string; line: number; source?: { path?: string } }[];
    };
    const list: StackFrame[] = (stack.stackFrames ?? []).map((f) => ({
      id: f.id,
      name: f.name || "(кадр)",
      file: f.source?.path ?? "",
      line: f.line,
    }));
    setFrames(list);
    const top = list[0];
    if (top?.file) {
      setPausedLine({ file: top.file, line: top.line });
      await openFile(top.file);
      revealLine(top.line);
      markStoppedLine(top.line);
      await loadScopes(top.id);
    }
  } catch (e) {
    emitOutput(`Не удалось получить стек: ${e}\n`, "stderr");
  }
}

export async function loadScopes(frameId: number): Promise<void> {
  try {
    const raw = (await request("scopes", { frameId })) as { scopes?: { name: string; variablesReference: number }[] };
    const result: ScopeVars[] = [];
    for (const scope of (raw.scopes ?? []).filter((s) => s.variablesReference > 0).slice(0, 4)) {
      const vars = (await request("variables", { variablesReference: scope.variablesReference, start: 0, count: 200 })) as {
        variables?: { name: string; value: string; type?: string; variablesReference: number }[];
      };
      result.push({
        name: scope.name,
        vars: (vars.variables ?? []).map((v) => ({ name: v.name, value: v.value, type: v.type, variablesReference: v.variablesReference })),
      });
    }
    setScopes(result);
  } catch (e) {
    emitOutput(`Не удалось получить переменные: ${e}\n`, "stderr");
  }
}

// ---------- команды сеанса ----------

async function threadIdFor(): Promise<number | null> {
  try {
    const threads = (await request("threads")) as { threads?: { id: number }[] };
    return threads.threads?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function continueDebugging(): Promise<void> {
  const threadId = await threadIdFor();
  if (threadId === null) return;
  clearStopMarker();
  try {
    await request("continue", { threadId });
  } catch {
    /* событие continued придёт само */
  }
}

export async function stepOver(): Promise<void> {
  const threadId = await threadIdFor();
  if (threadId === null) return;
  clearStopMarker();
  try {
    await request("next", { threadId, granularity: "statement" });
  } catch (e) {
    notifyError("Шаг не выполнен", e);
  }
}

export async function stepInto(): Promise<void> {
  const threadId = await threadIdFor();
  if (threadId === null) return;
  clearStopMarker();
  try {
    await request("stepIn", { threadId, granularity: "statement" });
  } catch (e) {
    notifyError("Шаг не выполнен", e);
  }
}

export async function stepOut(): Promise<void> {
  const threadId = await threadIdFor();
  if (threadId === null) return;
  clearStopMarker();
  try {
    await request("stepOut", { threadId, granularity: "statement" });
  } catch (e) {
    notifyError("Шаг не выполнен", e);
  }
}

/** Остановить отладку: вежливый disconnect, затем убить адаптер. */
export async function stopDebugging(): Promise<void> {
  stopping = true;
  const id = adapterId;
  clearStopMarker();
  setPausedLine(null);
  setFrames([]);
  setScopes([]);
  if (id !== null) {
    try {
      await request("disconnect", { terminateDebuggee: true, restart: false }, 3000);
    } catch {
      /* процесс могли убить раньше */
    }
    try {
      await core.lspStop(id);
    } catch {
      /* уже остановлен */
    }
  }
  adapterId = null;
  detachAdapterEvents();
  setStatus("ended");
}

function endSession() {
  clearStopMarker();
  setPausedLine(null);
  setFrames([]);
  setScopes([]);
  if (adapterId !== null) void core.lspStop(adapterId).catch(() => undefined);
  adapterId = null;
  detachAdapterEvents();
  setStatus("ended");
  emitOutput("Программа завершилась.\n", "info");
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
  withEditor((editor) => {
    editor.revealLineInCenter(line);
  });
}

function markStoppedLine(line: number) {
  withEditor((editor) => {
    stopDecorations = editor.createDecorationsCollection([
      {
        options: { isWholeLine: true, className: "debug-stopped-line", zIndex: -1 },
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

/** Подсветить точки останова: EditorGroup держит коллекцию и вызывает set() сам. */
export function breakpointDecorationOptions(lines: number[]) {
  return lines.map((line) => ({
    options: {
      isWholeLine: false,
      linesDecorationsClassName: "debug-breakpoint-gutter",
    },
    range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
  }));
}
