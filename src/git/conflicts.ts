// Конфликты слияния: блоки <<<<<<< / ======= / >>>>>>> подсвечиваются, а над
// каждым — кнопки «Принять текущее / Принять входящее / Оба».
import { monaco } from "../editor/monaco";

interface Conflict {
  start: number;
  mid: number;
  end: number;
  /** Строка ||||||| (diff3), если есть */
  base: number | null;
}

function findConflicts(model: monaco.editor.ITextModel): Conflict[] {
  const out: Conflict[] = [];
  let start = -1;
  let mid = -1;
  let base: number | null = null;
  for (let i = 1; i <= model.getLineCount(); i++) {
    const t = model.getLineContent(i);
    if (t.startsWith("<<<<<<<")) {
      start = i;
      mid = -1;
      base = null;
    } else if (start > 0 && t.startsWith("|||||||")) base = i;
    else if (start > 0 && t.startsWith("=======")) mid = i;
    else if (start > 0 && mid > 0 && t.startsWith(">>>>>>>")) {
      out.push({ start, mid, end: i, base });
      start = -1;
    }
  }
  return out;
}

function resolve(model: monaco.editor.ITextModel, c: Conflict, take: "current" | "incoming" | "both") {
  const lines = (from: number, to: number) => (from > to ? [] : Array.from({ length: to - from + 1 }, (_, k) => model.getLineContent(from + k)));
  const current = lines(c.start + 1, (c.base ?? c.mid) - 1);
  const incoming = lines(c.mid + 1, c.end - 1);
  const keep = take === "current" ? current : take === "incoming" ? incoming : [...current, ...incoming];
  const range = new monaco.Range(c.start, 1, c.end, model.getLineMaxColumn(c.end));
  model.pushEditOperations([], [{ range, text: keep.join(model.getEOL()) }], () => null);
}

const decorationIds = new WeakMap<monaco.editor.ITextModel, string[]>();

function decorate(model: monaco.editor.ITextModel) {
  const conflicts = findConflicts(model);
  const decos: monaco.editor.IModelDeltaDecoration[] = [];
  for (const c of conflicts) {
    decos.push(
      { range: new monaco.Range(c.start, 1, c.start, 1), options: { isWholeLine: true, className: "conflict-marker conflict-current-head" } },
      { range: new monaco.Range(c.start + 1, 1, Math.max(c.start + 1, (c.base ?? c.mid) - 1), 1), options: { isWholeLine: true, className: "conflict-current" } },
      { range: new monaco.Range(c.mid, 1, c.mid, 1), options: { isWholeLine: true, className: "conflict-marker" } },
      { range: new monaco.Range(c.mid + 1, 1, Math.max(c.mid + 1, c.end - 1), 1), options: { isWholeLine: true, className: "conflict-incoming" } },
      { range: new monaco.Range(c.end, 1, c.end, 1), options: { isWholeLine: true, className: "conflict-marker conflict-incoming-head" } },
    );
  }
  decorationIds.set(model, model.deltaDecorations(decorationIds.get(model) ?? [], decos));
}

export function initConflicts() {
  const cmd = "tulpar.conflict.resolve";
  monaco.editor.registerCommand(cmd, (_a, uri: string, start: number, take: "current" | "incoming" | "both") => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    const c = findConflicts(model).find((x) => x.start === start);
    if (c) resolve(model, c, take);
  });

  monaco.languages.registerCodeLensProvider("*" as any, {
    provideCodeLenses(model) {
      const lenses = findConflicts(model).flatMap((c) => {
        const range = new monaco.Range(c.start, 1, c.start, 1);
        const uri = model.uri.toString();
        return [
          { range, command: { id: cmd, title: "✓ Принять текущее", arguments: [uri, c.start, "current"] } },
          { range, command: { id: cmd, title: "✓ Принять входящее", arguments: [uri, c.start, "incoming"] } },
          { range, command: { id: cmd, title: "Оставить оба", arguments: [uri, c.start, "both"] } },
        ];
      });
      return { lenses, dispose: () => undefined };
    },
  });

  const watch = (model: monaco.editor.ITextModel) => {
    if (model.uri.scheme !== "file") return;
    decorate(model);
    let t: number | undefined;
    model.onDidChangeContent(() => {
      clearTimeout(t);
      t = window.setTimeout(() => decorate(model), 300);
    });
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}
