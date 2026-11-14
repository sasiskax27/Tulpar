// Сочетания клавиш в формате VS Code: "ctrl+shift+p", аккорды "ctrl+k ctrl+o",
// отмена стандартного сочетания через "-команда".
import { createMemo } from "solid-js";
import { userKeybindings, type Keybinding } from "../config/store";
import { executeCommand } from "../commands/registry";

const isMac = navigator.userAgent.includes("Mac");

// "mod" = Ctrl на Windows/Linux и Cmd на macOS — только для встроенных сочетаний.
const defaults: Keybinding[] = [
  { key: "mod+shift+p", command: "workbench.action.showCommands" },
  { key: "f1", command: "workbench.action.showCommands" },
  { key: "mod+p", command: "workbench.action.quickOpen" },
  { key: "mod+s", command: "workbench.action.files.save" },
  { key: "mod+alt+s", command: "workbench.action.files.saveAll" },
  { key: "mod+w", command: "workbench.action.closeActiveEditor" },
  { key: "mod+k mod+o", command: "workbench.action.files.openFolder" },
  // Второе нажатие и без Ctrl — так удобнее, а в VS Code многие ошибаются именно здесь
  { key: "mod+k o", command: "workbench.action.files.openFolder" },
  { key: "mod+b", command: "workbench.action.toggleSidebarVisibility" },
  { key: "mod+shift+e", command: "workbench.view.explorer" },
  { key: "mod+shift+f", command: "workbench.view.search" },
  { key: "ctrl+shift+g", command: "workbench.view.scm" },
  { key: "mod+alt+i", command: "workbench.action.chat.open" },
  { key: "mod+g", command: "workbench.action.gotoLine" },
  { key: "ctrl+tab", command: "workbench.action.nextEditor" },
  { key: "ctrl+shift+tab", command: "workbench.action.previousEditor" },
  { key: "ctrl+pagedown", command: "workbench.action.nextEditor" },
  { key: "ctrl+pageup", command: "workbench.action.previousEditor" },
  { key: "mod+k z", command: "workbench.action.toggleZenMode" },
  { key: "mod+,", command: "workbench.action.openSettings" },
  { key: "ctrl+`", command: "workbench.action.terminal.toggleTerminal" },
  { key: "ctrl+shift+`", command: "workbench.action.terminal.new" },
  { key: "mod+1", command: "workbench.action.focusActiveEditorGroup" },
  { key: "mod+=", command: "editor.action.fontZoomIn" },
  { key: "mod+-", command: "editor.action.fontZoomOut" },
  { key: "mod+0", command: "editor.action.fontZoomReset" },
];

/** В терминале почти все клавиши принадлежат оболочке (Ctrl+W, Ctrl+S, Ctrl+K…).
 *  Редактор забирает себе только эти команды. */
const WORKS_IN_TERMINAL = new Set([
  "workbench.action.showCommands",
  "workbench.action.quickOpen",
  "workbench.view.search",
  "workbench.view.explorer",
  "workbench.view.scm",
  "workbench.action.chat.open",
  "workbench.action.terminal.toggleTerminal",
  "workbench.action.terminal.new",
  "workbench.action.focusActiveEditorGroup",
  "workbench.action.toggleSidebarVisibility",
  "workbench.action.nextEditor",
  "workbench.action.previousEditor",
  "workbench.action.openSettings",
]);

const MOD_ORDER = ["ctrl", "shift", "alt", "meta"] as const;

/** Приводит одно нажатие из текста ("Shift+Ctrl+P", "cmd+s") к виду "ctrl+shift+p". */
function normalizeStroke(stroke: string): string {
  const parts = stroke.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    if (p === "mod") mods.add(isMac ? "meta" : "ctrl");
    else if (p === "cmd" || p === "win" || p === "meta" || p === "super") mods.add("meta");
    else if (p === "ctrl" || p === "control") mods.add("ctrl");
    else if (p === "shift" || p === "alt") mods.add(p);
    else if (p === "option") mods.add("alt");
    else key = p;
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

const CODE_NAMES: Record<string, string> = {
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'",
  Backquote: "`", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=",
  Space: "space", Escape: "escape", Enter: "enter", Tab: "tab", Backspace: "backspace",
  Delete: "delete", Insert: "insert", Home: "home", End: "end", PageUp: "pageup",
  PageDown: "pagedown", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
};

/** Нажатие клавиатуры → "ctrl+shift+p". Используем физическую клавишу (code),
 *  чтобы сочетания работали в любой раскладке, включая русскую. */
function strokeFromEvent(e: KeyboardEvent): string | null {
  const code = e.code;
  if (!code || /^(Control|Shift|Alt|Meta|OS)/.test(code)) return null;
  let key: string;
  if (code.startsWith("Key")) key = code.slice(3).toLowerCase();
  else if (code.startsWith("Digit")) key = code.slice(5);
  else if (code.startsWith("Numpad")) key = "numpad" + code.slice(6).toLowerCase();
  else if (/^F\d+$/.test(code)) key = code.toLowerCase();
  else key = CODE_NAMES[code] ?? e.key.toLowerCase();
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey) mods.push("alt");
  if (e.metaKey) mods.push("meta");
  return [...mods, key].join("+");
}

interface Resolved {
  strokes: string[];
  command: string;
  args?: unknown;
}

const resolved = createMemo<Resolved[]>(() => {
  let list: Resolved[] = defaults.map((b) => ({
    strokes: b.key.split(" ").filter(Boolean).map(normalizeStroke),
    command: b.command,
    args: b.args,
  }));
  for (const b of userKeybindings()) {
    if (typeof b?.key !== "string" || typeof b?.command !== "string") continue;
    const strokes = b.key.split(" ").filter(Boolean).map(normalizeStroke);
    if (b.command.startsWith("-")) {
      const target = b.command.slice(1);
      list = list.filter((r) => !(r.command === target && r.strokes.join(" ") === strokes.join(" ")));
    } else {
      // Пользовательское сочетание важнее стандартного с теми же клавишами
      list = list.filter((r) => r.strokes.join(" ") !== strokes.join(" "));
      list.push({ strokes, command: b.command, args: b.args });
    }
  }
  return list;
});

/** Сочетание для команды — чтобы показать его в палитре. */
export function keybindingFor(command: string): string | undefined {
  const r = resolved().find((x) => x.command === command);
  if (!r) return;
  return r.strokes
    .map((s) => s.split("+").map((p) => (p === "meta" ? (isMac ? "⌘" : "Win") : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("+"))
    .join(" ");
}

let pending: string | null = null;
let pendingTimer: number | undefined;

export function installKeybindings() {
  window.addEventListener(
    "keydown",
    (e) => {
      const stroke = strokeFromEvent(e);
      if (!stroke) return;
      const inTerminal = e.target instanceof Element && !!e.target.closest(".terminal-host");
      const bindings = inTerminal
        ? resolved().filter((b) => b.strokes.length === 1 && WORKS_IN_TERMINAL.has(b.command))
        : resolved();

      if (pending) {
        const first = pending;
        pending = null;
        clearTimeout(pendingTimer);
        const hit = bindings.find((b) => b.strokes.length === 2 && b.strokes[0] === first && b.strokes[1] === stroke);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          void executeCommand(hit.command, hit.args);
          return;
        }
      }

      const single = bindings.find((b) => b.strokes.length === 1 && b.strokes[0] === stroke);
      if (single) {
        e.preventDefault();
        e.stopPropagation();
        void executeCommand(single.command, single.args);
        return;
      }

      if (bindings.some((b) => b.strokes.length === 2 && b.strokes[0] === stroke)) {
        e.preventDefault();
        e.stopPropagation();
        pending = stroke;
        pendingTimer = window.setTimeout(() => (pending = null), 2000);
      }
    },
    true, // фаза перехвата: срабатываем раньше Monaco
  );
}
