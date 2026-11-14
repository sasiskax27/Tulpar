// Цветные метки на полях редактора: зелёная — новые строки, синяя — изменённые,
// красный треугольник — здесь что-то удалено. Сравнение с последним коммитом.
import { createEffect, createRoot, on } from "solid-js";
import { monaco } from "../editor/monaco";
import { editorInstance } from "../editor/instance";
import { activePath } from "../editor/tabs";
import { core } from "../ipc";
import { status, headVersion } from "./git";
import { diffLines } from "./linediff";

/** Текст файла в последнем коммите. null — файла там нет или репозитория нет. */
const headCache = new Map<string, Promise<string | null>>();
let decorations: monaco.editor.IEditorDecorationsCollection | undefined;
let timer: number | undefined;

function headText(path: string): Promise<string | null> {
  let p = headCache.get(path);
  if (!p) {
    const untracked = status()?.files.some((f) => f.abs === path && f.work === "?");
    p = untracked ? Promise.resolve("") : core.gitShowHead(path).catch(() => null);
    headCache.set(path, p);
  }
  return p;
}

async function update() {
  const editor = editorInstance();
  const model = editor?.getModel();
  if (!editor) return;
  if (!decorations) decorations = editor.createDecorationsCollection();
  if (!model || model.uri.scheme !== "file" || !status()?.isRepo) {
    decorations.clear();
    return;
  }
  const head = await headText(model.uri.fsPath);
  if (editor.getModel() !== model || model.isDisposed()) return;
  if (head === null) {
    decorations.clear();
    return;
  }
  const changes = diffLines(head, model.getValue());
  decorations.set(
    changes.map((c) => ({
      range: new monaco.Range(c.start, 1, c.end, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `git-gutter-${c.kind}`,
        overviewRuler: {
          color: c.kind === "added" ? "#2ea04399" : c.kind === "modified" ? "#1b81a899" : "#f8514999",
          position: monaco.editor.OverviewRulerLane.Left,
        },
      },
    })),
  );
}

function updateSoon() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void update(), 250);
}

let contentSub: monaco.IDisposable | undefined;

export function initGitGutter() {
  createRoot(() => {
    // Новый статус (коммит, переключение ветки) — коммит мог измениться
    createEffect(
      on(headVersion, () => {
        headCache.clear();
        updateSoon();
      }),
    );
    // Другая вкладка — перерисовать и следить за правками в ней
    createEffect(
      on(activePath, () => {
        // Редактор меняет модель в своём эффекте — подписываемся после него
        setTimeout(() => {
          contentSub?.dispose();
          const model = editorInstance()?.getModel();
          contentSub = model?.onDidChangeContent(updateSoon);
          updateSoon();
        }, 0);
      }),
    );
  });
}
