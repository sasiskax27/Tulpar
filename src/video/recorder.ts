// «Код в видео»: запись того, как вы пишете код. Запоминаем исходный текст
// каждого затронутого файла и все правки с отметкой времени — из этого потом
// собирается ролик, где код печатается сам.
import { createSignal } from "solid-js";
import type { monaco } from "../editor/monaco";
import { editorInstance } from "../editor/instance";
import { activePath, modelFor } from "../editor/tabs";
import { notify } from "../app/notify";

export interface RecordedOp {
  t: number;
  path: string;
  offset: number;
  deleteLen: number;
  text: string;
}

export interface Recording {
  started: number;
  ended: number;
  files: Record<string, { initial: string; language: string }>;
  ops: RecordedOp[];
}

const [recording, setRecording] = createSignal(false);
const [lastRecording, setLastRecording] = createSignal<Recording | null>(null);
const [startedAt, setStartedAt] = createSignal(0);
export { recording, lastRecording, startedAt };

let current: Recording | null = null;
let subs: monaco.IDisposable[] = [];

function track(path: string | null, model: monaco.editor.ITextModel | null) {
  if (!current || !path || !model || path.startsWith("diff:")) return;
  if (!current.files[path]) current.files[path] = { initial: model.getValue(), language: model.getLanguageId() };
}

export function startRecording() {
  const editor = editorInstance();
  if (!editor) {
    notify("Откройте файл, чтобы начать запись");
    return;
  }
  current = { started: Date.now(), ended: 0, files: {}, ops: [] };
  track(activePath(), editor.getModel());
  subs.push(
    editor.onDidChangeModel(() => track(activePath(), editor.getModel())),
    editor.onDidChangeModelContent((e) => {
      const path = activePath();
      const model = editor.getModel();
      if (!current || !path || !model) return;
      if (!current.files[path]) {
        // Файл впервые попал в запись уже с правкой — откатываем правку в «исходном» тексте
        current.files[path] = { initial: model.getValue(), language: model.getLanguageId() };
        return;
      }
      const t = Date.now() - current.started;
      // Правки одного события идут с конца к началу — применяем как есть, по порядку
      for (const c of [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
        current.ops.push({ t, path, offset: c.rangeOffset, deleteLen: c.rangeLength, text: c.text });
      }
    }),
  );
  setStartedAt(current.started);
  setRecording(true);
  notify("🎬 Запись кода началась. Пишите код как обычно — потом нажмите «Стоп» внизу, и Tulpar сделает видео.");
}

export function stopRecording(): Recording | null {
  subs.forEach((s) => s.dispose());
  subs = [];
  setRecording(false);
  if (!current) return null;
  current.ended = Date.now();
  const rec = current;
  current = null;
  if (!rec.ops.length) {
    notify("Запись пустая — за это время код не менялся");
    return null;
  }
  setLastRecording(rec);
  return rec;
}

/** Текущий текст файла — если в записи его нет. */
export function liveText(path: string) {
  return modelFor(path)?.getValue() ?? "";
}
