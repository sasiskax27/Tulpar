// Символы файла (функции, классы, методы) для «Структуры» и хлебных крошек.
// Источник — языковой сервер (documentSymbol) или встроенный движок TypeScript/JavaScript.
import { monaco } from "./monaco";
import { clientFor } from "../lsp/manager";

export interface Sym {
  name: string;
  kind: number;
  detail?: string;
  /** Строки с 1, включительно */
  start: number;
  end: number;
  /** Позиция имени (для перехода) */
  line: number;
  column: number;
  children: Sym[];
}

/** Типы символов LSP → короткая метка и цвет. */
export const KIND: Record<number, [string, string]> = {
  2: ["mod", "#9C27B0"], 3: ["ns", "#9C27B0"], 4: ["pkg", "#9C27B0"], 5: ["C", "#E8956A"], 6: ["m", "#B9A6FF"],
  7: ["p", "#5CC8B8"], 8: ["f", "#5CC8B8"], 9: ["new", "#B9A6FF"], 10: ["E", "#E8956A"], 11: ["I", "#86C9C4"],
  12: ["fn", "#F0B840"], 13: ["v", "#A9BDFF"], 14: ["K", "#FF9F7A"], 22: ["e", "#FF9F7A"], 23: ["S", "#E8956A"],
  26: ["T", "#86C9C4"],
};

function fromLsp(items: any[]): Sym[] {
  if (!Array.isArray(items)) return [];
  // DocumentSymbol[] (дерево) или SymbolInformation[] (плоский список)
  if (items.length && items[0].location) {
    return items.map((s) => ({
      name: s.name,
      kind: s.kind,
      detail: s.containerName,
      start: s.location.range.start.line + 1,
      end: s.location.range.end.line + 1,
      line: s.location.range.start.line + 1,
      column: s.location.range.start.character + 1,
      children: [],
    }));
  }
  return items.map((s) => ({
    name: s.name,
    kind: s.kind,
    detail: s.detail,
    start: s.range.start.line + 1,
    end: s.range.end.line + 1,
    line: (s.selectionRange ?? s.range).start.line + 1,
    column: (s.selectionRange ?? s.range).start.character + 1,
    children: fromLsp(s.children ?? []),
  }));
}

const TS_KIND: Record<string, number> = {
  class: 5, method: 6, property: 7, function: 12, var: 13, let: 13, const: 14, interface: 11, enum: 10,
  type: 26, module: 2, constructor: 9, getter: 7, setter: 7,
};

async function fromTypeScript(model: monaco.editor.ITextModel): Promise<Sym[]> {
  const lang = model.getLanguageId();
  const ts = (monaco.languages as any).typescript;
  if (!ts) return [];
  const getWorker = lang === "typescript" ? ts.getTypeScriptWorker : ts.getJavaScriptWorker;
  const worker = await (await getWorker())(model.uri);
  const tree = await worker.getNavigationTree(model.uri.toString());
  const convert = (node: any): Sym | null => {
    const span = node.spans?.[0];
    if (!span) return null;
    const startPos = model.getPositionAt(span.start);
    const endPos = model.getPositionAt(span.start + span.length);
    const nameSpan = node.nameSpan ?? span;
    const namePos = model.getPositionAt(nameSpan.start);
    return {
      name: node.text,
      kind: TS_KIND[node.kind] ?? 13,
      start: startPos.lineNumber,
      end: endPos.lineNumber,
      line: namePos.lineNumber,
      column: namePos.column,
      children: (node.childItems ?? []).map(convert).filter(Boolean) as Sym[],
    };
  };
  return (tree?.childItems ?? []).map(convert).filter(Boolean) as Sym[];
}

export async function documentSymbols(model: monaco.editor.ITextModel): Promise<Sym[]> {
  const lang = model.getLanguageId();
  if (lang === "typescript" || lang === "javascript") {
    return fromTypeScript(model).catch(() => []);
  }
  const c = clientFor(model);
  if (!c?.capabilities.documentSymbolProvider) return [];
  const res = await c.request("textDocument/documentSymbol", { textDocument: { uri: model.uri.toString() } }).catch(() => null);
  return fromLsp(res ?? []);
}

/** Цепочка символов, внутри которых стоит строка (для хлебных крошек). */
export function symbolPath(symbols: Sym[], line: number): Sym[] {
  const path: Sym[] = [];
  let level = symbols;
  for (;;) {
    const hit = level.find((s) => s.start <= line && line <= s.end);
    if (!hit) return path;
    path.push(hit);
    level = hit.children;
  }
}
