// Ссылка на текущий экземпляр редактора — чтобы другие панели (терминал, палитра)
// могли вернуть в него фокус или вызвать его действие.
import type { monaco } from "./monaco";

let current: monaco.editor.IStandaloneCodeEditor | undefined;

export function setEditorInstance(editor: monaco.editor.IStandaloneCodeEditor | undefined) {
  current = editor;
}

export function editorInstance() {
  return current;
}

export function focusEditor() {
  current?.focus();
}
