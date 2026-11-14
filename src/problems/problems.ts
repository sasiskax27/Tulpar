// Проблемы проекта: ошибки и предупреждения от языковых серверов и встроенных
// проверок Monaco, одним списком. Для открытых файлов — метки редактора,
// для закрытых — то, что прислал языковой сервер.
import { createSignal } from "solid-js";
import { monaco } from "../editor/monaco";
import { openFile } from "../editor/tabs";
import { executeCommand } from "../commands/registry";
import { root } from "../app/workspace";
import { setBottomTab, setBottomVisible } from "../app/ui";

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
