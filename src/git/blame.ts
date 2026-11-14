// «Кто менял эту строку»: бледная подпись в конце строки с курсором —
// автор, когда и сообщение коммита (как GitLens).
import { createEffect, createRoot, on } from "solid-js";
import { monaco } from "../editor/monaco";
import { editorInstance } from "../editor/instance";
import { activePath, cursor, modelFor } from "../editor/tabs";
import { settings } from "../config/store";
import { core } from "../ipc";
import { status } from "./git";

let decorations: monaco.editor.IEditorDecorationsCollection | undefined;
let timer: number | undefined;
let generation = 0;

export function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "только что";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн назад`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} мес назад`;
  return `${Math.floor(mo / 12)} г назад`;
}

async function update() {
  const mine = ++generation;
  const editor = editorInstance();
  if (!editor) return;
  decorations ??= editor.createDecorationsCollection();
  const path = activePath();
  const model = path ? modelFor(path) : undefined;
  if (!model || !status()?.isRepo || settings()["git.blame.inline"] === false || editor.getModel() !== model) {
    decorations.clear();
    return;
  }
  const line = cursor().line;
  const dirty = model.getAlternativeVersionId() !== 1;
  const info = await core.gitBlameLine(path!, line, dirty ? model.getValue() : undefined).catch(() => null);
  if (mine !== generation || editor.getModel() !== model) return;
  if (!info) {
    decorations.clear();
    return;
  }
  const text = info.uncommitted ? "Вы · ещё не закоммичено" : `${info.author}, ${ago(info.time)} · ${info.summary}`;
  const maxCol = model.getLineMaxColumn(line);
  decorations.set([
    {
      range: new monaco.Range(line, maxCol, line, maxCol),
      options: { after: { content: `     ${text}`, inlineClassName: "git-blame-inline" } },
    },
  ]);
}

export function initBlame() {
  createRoot(() => {
    createEffect(
      on([cursor, activePath, () => settings()["git.blame.inline"]], () => {
        decorations?.clear();
        clearTimeout(timer);
        timer = window.setTimeout(() => void update(), 450);
      }),
    );
  });
}
