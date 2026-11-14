// Правки ИИ прямо в редакторе, как у Copilot: файл открывается, новые и
// изменённые строки подсвечены, место удаления помечено, а сверху — панель
// «Оставить / Отменить / Сравнить».
import { createSignal } from "solid-js";
import { monaco } from "../editor/monaco";
import { activePath, modelFor, openDiff, openFile } from "../editor/tabs";
import { baseName } from "../ipc";
import { diffLines } from "../git/linediff";

export interface Review {
  path: string;
  stepId: string;
  /** Текст до правки; null — файла не было */
  before: string | null;
  added: number;
  removed: number;
  /** Правка ещё не сохранена и ждёт решения */
  pending: boolean;
}

const [reviews, setReviews] = createSignal<Review[]>([]);
export { reviews };

/** Действия, которые выполняет агент по кнопкам панели. */
let handlers: { keep: (r: Review) => void; undo: (r: Review) => void } = { keep: () => undefined, undo: () => undefined };
export function setReviewHandlers(h: typeof handlers) {
  handlers = h;
}

const decorationIds = new Map<string, string[]>();

export function reviewFor(path: string | null): Review | undefined {
  return path ? reviews().find((r) => r.path.toLowerCase() === path.toLowerCase()) : undefined;
}

/** Сколько строк добавлено и удалено — для подписи «+3 −1». */
function count(before: string, after: string) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return { added: b.length - pre - suf, removed: a.length - pre - suf };
}

function decorate(model: monaco.editor.ITextModel, before: string | null) {
  const after = model.getValue();
  const changes = before === null ? [{ kind: "added" as const, start: 1, end: model.getLineCount() }] : diffLines(before, after);
  const decos: monaco.editor.IModelDeltaDecoration[] = changes.map((c) =>
    c.kind === "deleted"
      ? {
          range: new monaco.Range(c.start, 1, c.start, 1),
          options: {
            isWholeLine: true,
            className: "ai-line-deleted",
            linesDecorationsClassName: "ai-gutter-deleted",
            overviewRuler: { color: "#ff6b6bcc", position: monaco.editor.OverviewRulerLane.Full },
          },
        }
      : {
          range: new monaco.Range(c.start, 1, c.end, 1),
          options: {
            isWholeLine: true,
            className: "ai-line-added",
            linesDecorationsClassName: "ai-gutter-added",
            overviewRuler: { color: "#4cc38acc", position: monaco.editor.OverviewRulerLane.Full },
          },
        },
  );
  const key = model.uri.toString();
  decorationIds.set(key, model.deltaDecorations(decorationIds.get(key) ?? [], decos));
  return changes[0]?.start ?? 1;
}

function clearDecorations(path: string) {
  const model = modelFor(path);
  if (!model || model.isDisposed()) return;
  const key = model.uri.toString();
  model.deltaDecorations(decorationIds.get(key) ?? [], []);
  decorationIds.delete(key);
}

/**
 * Показать правку в редакторе. Если preview — текст кладётся в открытый файл
 * без сохранения (решение — кнопками), иначе файл уже записан на диск.
 * Возвращает путь, под которым файл открыт.
 */
export async function showReview(opts: { path: string; stepId: string; before: string | null; after: string; preview: boolean }): Promise<string> {
  await openFile(opts.path);
  const path = activePath() ?? opts.path;
  const model = modelFor(path);
  if (!model) return path;
  if (opts.preview && model.getValue() !== opts.after) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: opts.after }], () => null);
  }
  const firstLine = decorate(model, opts.before);
  // Прокрутить к первой правке
  const { editorInstance } = await import("../editor/instance");
  const editor = editorInstance();
  if (editor?.getModel() === model) editor.revealLineInCenterIfOutsideViewport(firstLine);

  const { added, removed } = opts.before === null ? { added: model.getLineCount(), removed: 0 } : count(opts.before, opts.after);
  setReviews((list) => [
    ...list.filter((r) => r.path.toLowerCase() !== path.toLowerCase()),
    { path, stepId: opts.stepId, before: opts.before, added, removed, pending: opts.preview },
  ]);
  return path;
}

export function setReviewPending(path: string, pending: boolean) {
  setReviews((list) => list.map((r) => (r.path === path ? { ...r, pending } : r)));
}

/** Убрать подсветку и панель (после «Оставить» или «Отменить»). */
export function closeReview(path: string) {
  clearDecorations(path);
  setReviews((list) => list.filter((r) => r.path.toLowerCase() !== path.toLowerCase()));
}

export function keepReview(r: Review) {
  handlers.keep(r);
}
export function undoReview(r: Review) {
  handlers.undo(r);
}
export function compareReview(r: Review) {
  void openDiff(r.path, r.before ?? "", `${baseName(r.path)} (правка ИИ)`);
}

/** Оставить все правки, которые сейчас подсвечены. */
export function keepAll() {
  for (const r of reviews()) handlers.keep(r);
}
