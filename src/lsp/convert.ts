// Перевод между типами Monaco и LSP. Позиции: в Monaco строки и столбцы с 1, в LSP — с 0.
// Оба считают столбцы в UTF-16, так что дополнительного пересчёта не нужно.
import { monaco } from "../editor/monaco";

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface LspTextEdit { range: LspRange; newText: string }
export interface LspLocation { uri: string; range: LspRange }

export function toLspPosition(p: monaco.IPosition): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

export function toRange(r: LspRange): monaco.Range {
  return new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
}

export function toTextEdit(e: LspTextEdit): monaco.languages.TextEdit {
  return { range: toRange(e.range), text: e.newText };
}

/** Документация LSP (строка, MarkupContent или MarkedString) → Markdown для Monaco. */
export function toMarkdown(doc: any): monaco.IMarkdownString[] {
  if (doc == null) return [];
  if (typeof doc === "string") return doc ? [{ value: doc }] : [];
  if (Array.isArray(doc)) return doc.flatMap(toMarkdown);
  if (typeof doc.kind === "string") {
    return doc.value ? [{ value: doc.kind === "markdown" ? doc.value : escapeMarkdown(doc.value) }] : [];
  }
  if (typeof doc.language === "string") return [{ value: "```" + doc.language + "\n" + doc.value + "\n```" }];
  return [];
}

export function toDocumentation(doc: any): string | monaco.IMarkdownString | undefined {
  if (doc == null) return undefined;
  if (typeof doc === "string") return doc;
  return toMarkdown(doc)[0];
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}

/** Location | Location[] | LocationLink[] | null → список мест. */
export function toLocations(result: any): LspLocation[] {
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  return list.map((l: any) =>
    "targetUri" in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l,
  );
}

const lspKindNames = [
  "", "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface",
  "Module", "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File",
  "Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter",
] as const;

export function toCompletionKind(kind: number | undefined): monaco.languages.CompletionItemKind {
  const name = lspKindNames[kind ?? 1] ?? "Text";
  const kinds = monaco.languages.CompletionItemKind as unknown as Record<string, number>;
  return (kinds[name] ?? kinds.Text) as monaco.languages.CompletionItemKind;
}

export function toSeverity(severity: number | undefined): monaco.MarkerSeverity {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    default: return monaco.MarkerSeverity.Hint;
  }
}
