// Цветовые темы: классические «Тёмная» и «Светлая» и три темы Tulpar —
// «Ночная степь», «Беркут», «Рассвет» (цвета — из docs/DESIGN.md).
// Тема задаёт цвета интерфейса (CSS-переменные), подсветку кода в Monaco
// и цвета терминала.
import type { ITheme } from "@xterm/xterm";
import * as monaco from "monaco-editor";

export type ThemeId = "dark" | "light" | "steppe" | "berkut" | "dawn";

interface Palette {
  light: boolean;
  bg: string; island: string; panel: string; line: string; code: string;
  text: string; muted: string; strong: string; accent: string; onAccent: string; selection: string;
  kw: string; fn: string; str: string; num: string; com: string; param: string; type: string; punct: string;
  err: string; ok: string;
}

const PALETTES: Record<Exclude<ThemeId, "dark" | "light">, Palette> = {
  steppe: {
    light: false,
    bg: "#0B0F1C", island: "#141A2C", panel: "#212944", line: "#232B45", code: "#0E1324",
    text: "#DCE0EC", muted: "#8C95B3", strong: "#FFFFFF", accent: "#F0B840", onAccent: "#1A1406", selection: "#2A3558",
    kw: "#B9A6FF", fn: "#F0B840", str: "#8FDCB4", num: "#FF9F7A", com: "#7F89A8", param: "#A9BDFF", type: "#5CC8B8", punct: "#8C95B3",
    err: "#FF8D8D", ok: "#6FD3A8",
  },
  berkut: {
    light: false,
    bg: "#120F0C", island: "#1C1814", panel: "#2B251F", line: "#2C2620", code: "#16130F",
    text: "#ECE4D6", muted: "#A39A8B", strong: "#FFFFFF", accent: "#F2C14E", onAccent: "#1A1406", selection: "#3A3125",
    kw: "#E8956A", fn: "#F2C14E", str: "#B2CF85", num: "#DDA9EC", com: "#8F8677", param: "#E9CBA3", type: "#86C9C4", punct: "#A39A8B",
    err: "#F09A8A", ok: "#A9C97A",
  },
  dawn: {
    light: true,
    bg: "#F4F0E8", island: "#FFFFFF", panel: "#EEE8DC", line: "#E4DDCF", code: "#FBF8F2",
    text: "#2A2622", muted: "#6B655C", strong: "#000000", accent: "#9A5B00", onAccent: "#FFFFFF", selection: "#F3DFB8",
    kw: "#8A3FB0", fn: "#9A5B00", str: "#2D6E3A", num: "#B4441F", com: "#6E675D", param: "#2F5FA8", type: "#1F6F78", punct: "#6E675D",
    err: "#B4441F", ok: "#2D6E3A",
  },
};

export const THEME_NAMES: [ThemeId, string][] = [
  ["steppe", "Ночная степь"],
  ["berkut", "Беркут"],
  ["dawn", "Рассвет"],
  ["dark", "Тёмная (классическая)"],
  ["light", "Светлая (классическая)"],
];

export function isLightTheme(id: string): boolean {
  if (id === "light") return true;
  return PALETTES[id as keyof typeof PALETTES]?.light ?? false;
}

/** Имя темы Monaco для настройки workbench.colorTheme. */
export function monacoTheme(id: string): string {
  if (id in PALETTES) return `tulpar-${id}`;
  return id === "light" ? "vs" : "vs-dark";
}

const strip = (hex: string) => hex.replace("#", "");

/** Зарегистрировать темы Tulpar в Monaco — один раз при запуске. */
export function defineMonacoThemes() {
  for (const [id, p] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(`tulpar-${id}`, {
      base: p.light ? "vs" : "vs-dark",
      inherit: true,
      rules: [
        { token: "", foreground: strip(p.text) },
        { token: "keyword", foreground: strip(p.kw), fontStyle: "bold" },
        { token: "keyword.flow", foreground: strip(p.kw), fontStyle: "bold" },
        { token: "storage", foreground: strip(p.kw) },
        { token: "string", foreground: strip(p.str) },
        { token: "string.escape", foreground: strip(p.num) },
        { token: "regexp", foreground: strip(p.num) },
        { token: "number", foreground: strip(p.num) },
        { token: "constant", foreground: strip(p.num) },
        { token: "comment", foreground: strip(p.com), fontStyle: "italic" },
        { token: "comment.doc", foreground: strip(p.com), fontStyle: "italic" },
        { token: "type", foreground: strip(p.type) },
        { token: "type.identifier", foreground: strip(p.type) },
        { token: "identifier", foreground: strip(p.text) },
        { token: "predefined", foreground: strip(p.fn) },
        { token: "function", foreground: strip(p.fn) },
        { token: "variable", foreground: strip(p.param) },
        { token: "variable.parameter", foreground: strip(p.param), fontStyle: "italic" },
        { token: "annotation", foreground: strip(p.num), fontStyle: "italic" },
        { token: "metatag", foreground: strip(p.num) },
        { token: "delimiter", foreground: strip(p.punct) },
        { token: "operator", foreground: strip(p.punct) },
        { token: "tag", foreground: strip(p.kw) },
        { token: "attribute.name", foreground: strip(p.param), fontStyle: "italic" },
        { token: "attribute.value", foreground: strip(p.str) },
        { token: "string.key.json", foreground: strip(p.param) },
        { token: "string.value.json", foreground: strip(p.str) },
        { token: "key", foreground: strip(p.param) },
      ],
      colors: {
        "editor.background": p.code,
        "editor.foreground": p.text,
        "editorLineNumber.foreground": p.light ? "#A39C90" : p.muted + "88",
        "editorLineNumber.activeForeground": p.text,
        "editor.lineHighlightBackground": p.accent + "12",
        "editor.lineHighlightBorder": "#00000000",
        "editor.selectionBackground": p.selection,
        "editor.inactiveSelectionBackground": p.selection + "99",
        "editorCursor.foreground": p.accent,
        "editorIndentGuide.background1": p.line,
        "editorIndentGuide.activeBackground1": p.accent + "66",
        "editorWhitespace.foreground": p.line,
        "editorBracketMatch.background": p.accent + "22",
        "editorBracketMatch.border": p.accent + "88",
        "editorWidget.background": p.island,
        "editorWidget.border": p.line,
        "editorSuggestWidget.background": p.island,
        "editorSuggestWidget.border": p.line,
        "editorSuggestWidget.selectedBackground": p.panel,
        "editorHoverWidget.background": p.island,
        "editorHoverWidget.border": p.line,
        "editorGhostText.foreground": p.muted + "AA",
        "editorError.foreground": p.err,
        "editorWarning.foreground": p.accent,
        "minimap.background": p.code,
        "scrollbarSlider.background": p.muted + "33",
        "scrollbarSlider.hoverBackground": p.muted + "55",
        "diffEditor.insertedTextBackground": p.ok + "22",
        "diffEditor.removedTextBackground": p.err + "22",
        "stickyScroll.background": p.code,
      },
    });
  }
}

/** CSS-переменные интерфейса для тем Tulpar (классические темы — в base.css). */
export function cssVars(id: string): Record<string, string> | null {
  const p = PALETTES[id as keyof typeof PALETTES];
  if (!p) return null;
  return {
    "--tp-bg": p.bg,
    "--tp-bg-sidebar": p.island,
    "--tp-bg-activity": p.island,
    "--tp-bg-tabs": p.bg,
    "--tp-bg-tab-active": p.code,
    "--tp-bg-hover": p.panel,
    "--tp-bg-selected": p.selection,
    "--tp-bg-input": p.light ? "#FFFFFF" : p.code,
    "--tp-bg-overlay": p.island,
    "--tp-fg": p.text,
    "--tp-fg-muted": p.muted,
    "--tp-fg-strong": p.strong,
    "--tp-border": p.line,
    "--tp-accent": p.accent,
    "--tp-on-accent": p.onAccent,
    "--tp-gold": p.accent,
    "--tp-error": p.err,
    "--tp-ok": p.ok,
    "--tp-code-bg": p.code,
    "--tp-shadow": p.light ? "0 12px 40px rgba(60,45,20,0.16)" : "0 12px 40px rgba(0,0,0,0.5)",
  };
}

/** Цвета терминала для тем Tulpar; null — классическая тема (её цвета в sessions.ts). */
export function terminalTheme(id: string): ITheme | null {
  const p = PALETTES[id as keyof typeof PALETTES];
  if (!p) return null;
  return {
    background: p.code,
    foreground: p.text,
    cursor: p.accent,
    selectionBackground: p.selection,
    black: p.light ? "#2A2622" : "#1A1F33", red: p.err, green: p.ok, yellow: p.accent,
    blue: p.param, magenta: p.kw, cyan: p.type, white: p.light ? "#6B655C" : "#DCE0EC",
    brightBlack: p.muted, brightRed: p.err, brightGreen: p.str, brightYellow: p.fn,
    brightBlue: p.param, brightMagenta: p.kw, brightCyan: p.type, brightWhite: p.strong,
  };
}
