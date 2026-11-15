// 🎤 Режим презентации: крупный шрифт, только код, подсветка выделенного и
// показ нажатых сочетаний клавиш — для уроков, стримов и видео в TikTok.
import { createSignal } from "solid-js";
import { editorInstance } from "../editor/instance";
import { monaco, editorOptions } from "../editor/monaco";
import { executeCommand } from "../commands/registry";
import { settings } from "../config/store";

const [presenting, setPresenting] = createSignal(false);
export { presenting };

let cleanup: (() => void) | null = null;

const NAMES: Record<string, string> = {
  Control: "Ctrl", Meta: "⌘", Alt: "Alt", Shift: "Shift", " ": "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Enter: "Enter", Backspace: "⌫", Delete: "Del", Escape: "Esc", Tab: "Tab",
};

function keyOverlay(): () => void {
  const box = document.createElement("div");
  box.className = "present-keys";
  document.body.appendChild(box);
  const onKey = (e: KeyboardEvent) => {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const mods = [e.ctrlKey && "Ctrl", e.metaKey && "⌘", e.altKey && "Alt", e.shiftKey && e.key.length > 1 && "Shift"].filter(Boolean) as string[];
    // Обычные буквы без модификаторов не показываем — только сочетания и спецклавиши
    if (!mods.length && e.key.length === 1) return;
    const key = NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    const chip = document.createElement("span");
    chip.textContent = [...mods, key].join(" + ");
    box.appendChild(chip);
    while (box.children.length > 4) box.firstChild?.remove();
    setTimeout(() => chip.classList.add("out"), 1600);
    setTimeout(() => chip.remove(), 2100);
  };
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    box.remove();
  };
}

/** Всё, что вне выделения, приглушается. */
function spotlight(editor: monaco.editor.IStandaloneCodeEditor): () => void {
  const decor = editor.createDecorationsCollection();
  const update = () => {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel || sel.isEmpty()) {
      decor.clear();
      return;
    }
    const list: monaco.editor.IModelDeltaDecoration[] = [];
    if (sel.startLineNumber > 1) list.push({ range: new monaco.Range(1, 1, sel.startLineNumber - 1, 1), options: { isWholeLine: true, inlineClassName: "present-dim" } });
    if (sel.endLineNumber < model.getLineCount())
      list.push({ range: new monaco.Range(sel.endLineNumber + 1, 1, model.getLineCount(), 1), options: { isWholeLine: true, inlineClassName: "present-dim" } });
    decor.set(list);
  };
  const sub = editor.onDidChangeCursorSelection(update);
  return () => {
    sub.dispose();
    decor.clear();
  };
}

export function togglePresentation() {
  const editor = editorInstance();
  if (presenting()) {
    cleanup?.();
    cleanup = null;
    setPresenting(false);
    return;
  }
  setPresenting(true);
  void import("../hype/achievements").then((a) => a.unlock("presenter"));
  document.body.classList.add("tp-present");
  const s0 = settings();
  const base = s0["editor.fontSize"] ?? 14;
  editor?.updateOptions({ fontSize: Math.round(base * (s0["tulpar.present.scale"] ?? 1.6)), minimap: { enabled: false }, lineNumbers: "off", glyphMargin: false, folding: false, renderLineHighlight: "none", scrollBeyondLastLine: false });
  void executeCommand("workbench.action.toggleZenMode");
  const offKeys = keyOverlay();
  const offSpot = editor ? spotlight(editor) : () => undefined;
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape" && e.shiftKey) togglePresentation();
  };
  window.addEventListener("keydown", onEsc);
  cleanup = () => {
    offKeys();
    offSpot();
    window.removeEventListener("keydown", onEsc);
    document.body.classList.remove("tp-present");
    editor?.updateOptions(editorOptions(settings()));
    void executeCommand("workbench.action.toggleZenMode");
  };
}
