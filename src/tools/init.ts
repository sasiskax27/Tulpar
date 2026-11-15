// Фоновые части инструментов: копии файлов при сохранении и подсчёт времени.
import { monaco } from "../editor/monaco";
import { modelFor, onDidSave, tabs } from "../editor/tabs";
import { addSnapshot } from "./history";
import { recordEdit } from "./stats";
import { editorInstance } from "../editor/instance";
import { registerErrorExplain } from "./explain";

let started = false;

export function initTools() {
  if (started) return;
  started = true;
  registerErrorExplain();
  void import("../perf/lowend").then((m) => m.initLowEnd());
  onDidSave((model) => {
    void import("../hype/achievements").then((a) => a.count("saves", 1, { 1: "first-file", 100: "saves-100" }));
    if (model.uri.scheme !== "file") return;
    // Ключ — путь как во вкладках (fsPath меняет регистр буквы диска в Windows)
    const path = tabs.find((t) => !t.diffOf && modelFor(t.path) === model)?.path ?? model.uri.fsPath;
    void addSnapshot(path, model.getValue(), "save");
    void import("../flight/flight").then((f) => f.log("save", `Сохранён ${path.split(/[\\/]/).pop()}`));
    if (/[\\/]\.tulpar[\\/]brain\.md$/.test(path)) void import("../brain/brain").then((b) => b.reloadBrain());
  });
  const watch = (model: monaco.editor.ITextModel) => {
    if (model.uri.scheme !== "file") return;
    model.onDidChangeContent((e) => {
      recordEdit(model.getLanguageId());
      // Power mode — только для файла в основном редакторе
      if (editorInstance()?.getModel() === model) void import("../hype/power").then((p) => p.onType());
      const lines = e.changes.reduce((n, c) => n + (c.text.match(/\n/g)?.length ?? 0), 0);
      if (lines && !e.isUndoing && !e.isRedoing && e.changes.every((c) => c.text.length < 400)) void import("../hype/progress").then((p) => p.addLines(lines));
    });
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}
