// Проблемы проекта: ошибки и предупреждения от языковых серверов и встроенных
// проверок Monaco, одним списком. Для открытых файлов — метки редактора,
// для закрытых — то, что прислал языковой сервер.
import { createSignal } from "solid-js";
import { monaco } from "../editor/monaco";
import { openFile } from "../editor/tabs";
import { executeCommand } from "../commands/registry";
import { root } from "../app/workspace";
import { bottomTab, bottomVisible, setBottomTab, setBottomVisible, setSettingsVisible } from "../app/ui";
import { notify } from "../app/notify";
import { parseErrors, stripAnsi } from "./terminalErrors";

const untrackedTab = () => (bottomVisible() ? bottomTab() : null);

export interface Problem {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
  code?: string;
}

/** Диагностика языковых серверов по всем файлам, даже закрытым: uri → список. */
const lspStore = new Map<string, Problem[]>();
/** Ошибки из вывода терминалов: id сеанса → список. */
const terminalStore = new Map<string, Problem[]>();
const [problems, setProblems] = createSignal<Problem[]>([]);
export { problems };

const sev = (s: monaco.MarkerSeverity): Problem["severity"] | null =>
  s === monaco.MarkerSeverity.Error ? "error" : s === monaco.MarkerSeverity.Warning ? "warning" : s === monaco.MarkerSeverity.Info ? "info" : null;

let timer: number | undefined;
function rebuild() {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const list: Problem[] = [];
    const open = new Set<string>();
    for (const m of monaco.editor.getModelMarkers({})) {
      if (m.resource.scheme !== "file") continue;
      const severity = sev(m.severity);
      if (!severity) continue;
      open.add(m.resource.toString());
      list.push({
        path: m.resource.fsPath,
        line: m.startLineNumber,
        column: m.startColumn,
        endLine: m.endLineNumber,
        endColumn: m.endColumn,
        severity,
        message: m.message,
        source: m.source,
        code: typeof m.code === "string" ? m.code : m.code?.value,
      });
    }
    // Закрытые файлы: метки модели есть только у открытых
    for (const [uri, items] of lspStore) {
      if (open.has(uri) || monaco.editor.getModel(monaco.Uri.parse(uri))) continue;
      list.push(...items);
    }
    // Ошибки из терминала, если то же место уже не отмечено языковым сервером
    const known = new Set(list.map((p) => `${p.path.toLowerCase()}:${p.line}`));
    for (const items of terminalStore.values()) {
      for (const p of items) if (!known.has(`${p.path.toLowerCase()}:${p.line}`)) list.push(p);
    }
    const rank = { error: 0, warning: 1, info: 2 };
    list.sort((a, b) => a.path.localeCompare(b.path) || rank[a.severity] - rank[b.severity] || a.line - b.line);
    setProblems(list);
  }, 150);
}

/** Диагностика от языкового сервера (вызывается из lsp/manager). */
export function setLspDiagnostics(uri: string, diagnostics: any[]) {
  const path = monaco.Uri.parse(uri).fsPath;
  const items: Problem[] = [];
  for (const d of diagnostics ?? []) {
    const severity = d.severity === 1 ? "error" : d.severity === 2 ? "warning" : d.severity === 3 ? "info" : null;
    if (!severity) continue;
    items.push({
      path,
      line: (d.range?.start?.line ?? 0) + 1,
      column: (d.range?.start?.character ?? 0) + 1,
      endLine: (d.range?.end?.line ?? 0) + 1,
      endColumn: (d.range?.end?.character ?? 0) + 1,
      severity,
      message: String(d.message ?? ""),
      source: d.source,
      code: d.code === undefined ? undefined : String(d.code),
    });
  }
  if (items.length) lspStore.set(uri, items);
  else lspStore.delete(uri);
  rebuild();
}

export function clearLspDiagnostics() {
  lspStore.clear();
  rebuild();
}

// ---------- ошибки из терминала ----------

const MAX_LINES = 400;
const termLines = new Map<string, string[]>();
const termTail = new Map<string, string>();
const termTimers = new Map<string, number>();

/** Абсолютный путь в стиле открытой папки; null — файл не из проекта. */
function projectPath(file: string): string | null {
  const r = root();
  if (!r) return null;
  const sep = r.includes("\\") ? "\\" : "/";
  const isAbs = /^[A-Za-z]:[\\/]/.test(file) || file.startsWith("/");
  const clean = file.replace(/^\.[\\/]/, "");
  const abs = (isAbs ? clean : r.replace(/[\\/]+$/, "") + sep + clean).replace(/[\\/]/g, sep);
  return abs.toLowerCase().startsWith(r.toLowerCase()) ? r + abs.slice(r.length) : null;
}

/** Новый кусок вывода терминала. Разбор — с задержкой, когда вывод затих. */
export function feedTerminal(id: string, data: string) {
  const text = (termTail.get(id) ?? "") + stripAnsi(data);
  const parts = text.split("\n");
  termTail.set(id, parts.pop() ?? "");
  if (parts.length) {
    const lines = termLines.get(id) ?? [];
    lines.push(...parts);
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    termLines.set(id, lines);
  }
  clearTimeout(termTimers.get(id));
  termTimers.set(id, window.setTimeout(() => parseTerminal(id), 400));
}

/** Команды сборщиков и языков, которых может не быть на компьютере. */
const TOOL_NAMES: Record<string, string> = {
  mvn: "Maven", gradle: "Gradle", java: "Java (JDK)", javac: "Java (JDK)", python: "Python", python3: "Python",
  pip: "Python", node: "Node.js", npm: "Node.js", npx: "Node.js", dotnet: ".NET SDK", go: "Go", cargo: "Rust",
  rustc: "Rust", git: "Git", gh: "GitHub CLI", cmake: "CMake",
};
const warnedTools = new Set<string>();

/** «mvn не распознано», «command not found» — предложить установить. */
function checkMissingTool(lines: string[]) {
  for (const line of lines.slice(-30)) {
    const m =
      line.match(/(?:^|\s)'?([\w.]+)'?\s*:?\s*(?:The term '([\w.]+)' is not recognized|is not recognized as)/i) ??
      line.match(/The term '([\w.]+)' is not recognized/i) ??
      line.match(/Имя "([\w.]+)" не распознано/i) ??
      line.match(/(?:^|\s)([\w.]+): command not found/i) ??
      line.match(/'([\w.]+)' is not recognized as an internal or external command/i);
    const cmd = (m?.[2] ?? m?.[1] ?? "").toLowerCase().replace(/\.exe$/, "");
    const tool = TOOL_NAMES[cmd];
    if (!tool || warnedTools.has(tool)) continue;
    warnedTools.add(tool);
    notify(`${tool} не установлен на компьютере — поэтому команда «${cmd}» не нашлась.`, "error", [
      {
        label: "Установить…",
        run: () => {
          setSettingsVisible(true);
          setTimeout(() => document.querySelector(".toolchains")?.scrollIntoView({ behavior: "smooth" }), 200);
        },
      },
    ]);
  }
}

function parseTerminal(id: string) {
  const lines = [...(termLines.get(id) ?? []), termTail.get(id) ?? ""];
  checkMissingTool(lines);
  const before = terminalStore.get(id)?.length ?? 0;
  const found: Problem[] = [];
  for (const e of parseErrors(lines)) {
    const path = projectPath(e.file);
    if (!path) continue;
    found.push({
      path,
      line: e.line,
      column: e.column,
      endLine: e.line,
      endColumn: e.column + 1,
      severity: e.severity,
      message: e.message,
      source: `${e.source}, терминал`,
    });
  }
  if (found.length) terminalStore.set(id, found);
  else terminalStore.delete(id);
  rebuild();
  const errors = found.filter((p) => p.severity === "error");
  if (errors.length > before && errors.length && untrackedTab() !== "problems") {
    notify(
      errors.length === 1 ? `Ошибка в терминале: ${errors[0].message.slice(0, 120)}` : `В терминале ошибок: ${errors.length}`,
      "error",
      [
        { label: "Показать", run: showProblems },
        { label: "✦ Исправить с ИИ", run: () => void fixWithAi(errors) },
      ],
    );
  }
}

/** Новая команда в терминале — забываем его прошлые ошибки. */
export function resetTerminalErrors(id: string) {
  termLines.delete(id);
  termTail.delete(id);
  clearTimeout(termTimers.get(id));
  if (terminalStore.delete(id)) rebuild();
}

export function initProblems() {
  monaco.editor.onDidChangeMarkers(rebuild);
  monaco.editor.onWillDisposeModel(rebuild);
  rebuild();
}

export function counts() {
  let errors = 0;
  let warnings = 0;
  for (const p of problems()) {
    if (p.severity === "error") errors++;
    else if (p.severity === "warning") warnings++;
  }
  return { errors, warnings };
}

export function relOf(path: string): string {
  const r = root();
  if (r && path.toLowerCase().startsWith(r.toLowerCase())) return path.slice(r.length + 1).replace(/\\/g, "/");
  return path;
}

export function showProblems() {
  setBottomTab("problems");
  setBottomVisible(true);
}

export function goTo(p: Problem) {
  void openFile(p.path, new monaco.Range(p.line, p.column, p.endLine, p.endColumn));
}

/** Попросить агента исправить проблемы. */
export async function fixWithAi(list: Problem[]) {
  if (!list.length) return;
  const describe = (p: Problem) =>
    `- ${relOf(p.path)}:${p.line}:${p.column} ${p.severity === "error" ? "ошибка" : "предупреждение"}: ${p.message}${p.source ? ` (${p.source}${p.code ? ` ${p.code}` : ""})` : ""}`;
  const shown = list.slice(0, 30);
  const text =
    (list.length === 1 ? "Исправь эту проблему в коде:\n" : `Исправь эти проблемы в коде (${list.length}):\n`) +
    shown.map(describe).join("\n") +
    (list.length > shown.length ? `\n…и ещё ${list.length - shown.length}` : "") +
    "\nПрочитай нужные места, исправь и коротко скажи, что было не так.";
  const chat = await import("../ai/chat");
  chat.setAgentMode(true);
  await executeCommand("workbench.action.chat.open");
  void chat.send(text);
}

/** Лампочка в редакторе: «Исправить с ИИ» для ошибки под курсором. */
export function registerFixActions(editor: monaco.editor.IStandaloneCodeEditor) {
  const commandId = editor.addCommand(0, (_accessor: unknown, problem: Problem) => void fixWithAi([problem]));
  if (!commandId) return;
  monaco.languages.registerCodeActionProvider("*", {
    provideCodeActions(model, _range, context) {
      if (model.uri.scheme !== "file") return { actions: [], dispose: () => undefined };
      const actions = context.markers
        .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
        .slice(0, 1)
        .map((m) => ({
          title: "✦ Исправить с ИИ",
          kind: "quickfix",
          diagnostics: [m],
          command: {
            id: commandId,
            title: "Исправить с ИИ",
            arguments: [
              {
                path: model.uri.fsPath,
                line: m.startLineNumber,
                column: m.startColumn,
                endLine: m.endLineNumber,
                endColumn: m.endColumn,
                severity: m.severity === monaco.MarkerSeverity.Error ? "error" : "warning",
                message: m.message,
                source: m.source,
              } satisfies Problem,
            ],
          },
        }));
      return { actions, dispose: () => undefined };
    },
  });
}
