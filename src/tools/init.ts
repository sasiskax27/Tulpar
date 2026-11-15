// Фоновые части инструментов: копии файлов при сохранении и подсчёт времени.
import { monaco } from "../editor/monaco";
import { modelFor, onDidSave, tabs } from "../editor/tabs";
import { addSnapshot } from "./history";
import { recordEdit } from "./stats";
import { registerErrorExplain } from "./explain";

let started = false;

export function initTools() {
  if (started) return;
  started = true;
  registerErrorExplain();
  onDidSave((model) => {
    if (model.uri.scheme !== "file") return;
    // Ключ — путь как во вкладках (fsPath меняет регистр буквы диска в Windows)
    const path = tabs.find((t) => !t.diffOf && modelFor(t.path) === model)?.path ?? model.uri.fsPath;
    void addSnapshot(path, model.getValue(), "save");
  });
  const watch = (model: monaco.editor.ITextModel) => {
    if (model.uri.scheme !== "file") return;
    model.onDidChangeContent(() => recordEdit(model.getLanguageId()));
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}
