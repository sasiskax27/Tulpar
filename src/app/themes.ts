// Цветовые темы: классические «Тёмная» и «Светлая» и три темы Tulpar —
// «Ночная степь», «Беркут», «Рассвет» (цвета — из docs/DESIGN.md).
// Тема задаёт цвета интерфейса (CSS-переменные), подсветку кода в Monaco
// и цвета терминала.
import type { ITheme } from "@xterm/xterm";
import * as monaco from "monaco-editor";
import { settings } from "../config/store";
import { extThemes } from "../extensions/extensions";
import type { Palette } from "../extensions/vscodeTheme";

export type ThemeId = "dark" | "light" | "steppe" | "berkut" | "dawn" | "photo";


const PALETTES: Record<"steppe" | "berkut" | "dawn", Palette> = {
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

export const THEME_NAMES: [string, string][] = [
  ["steppe", "Ночная степь"],
  ["berkut", "Беркут"],
  ["dawn", "Рассвет"],
  ["photo", "Из фоновой картинки"],
  ["dark", "Тёмная (классическая)"],
  ["light", "Светлая (классическая)"],
];

/** Все темы: встроенные и из установленных расширений. */
export function allThemes(): [string, string][] {
  const ext = [...extThemes().values()].map((t): [string, string] => [t.id, `${t.label} · ${t.ext.split(".").pop()}`]);
  const saved = (settings()["tulpar.customThemes"] ?? {}) as Record<string, { name: string }>;
  const custom = Object.entries(saved).map(([id, t]): [string, string] => [`custom:${id}`, `${t.name} ✦`]);
  return [...THEME_NAMES, ...custom, ...ext];
}

// ---------- тема из фото ----------

export interface PhotoTheme {
  hue: number;
  sat: number;
  light: boolean;
}

/** Цвет из HSL (h в градусах, s и l — 0…100) в #rrggbb. */
export function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/**
 * Тема вокруг одного оттенка. Яркости фиксированные — поэтому читаемость
 * не зависит от фото; подсветка — оттенок, повёрнутый на постоянные углы.
 */
export function photoPalette(t: PhotoTheme): Palette {
  const h = t.hue;
  const sat = Math.max(35, Math.min(85, t.sat));
  const tint = sat * 0.35;
  if (t.light) {
    return {
      light: true,
      bg: hsl(h, tint, 94), island: hsl(h, tint, 99), panel: hsl(h, tint, 90), line: hsl(h, tint, 86), code: hsl(h, tint, 97.5),
      text: hsl(h, 20, 15), muted: hsl(h, 10, 40), strong: "#000000", accent: hsl(h, sat, 34), onAccent: "#ffffff", selection: hsl(h, 55, 85),
      kw: hsl(h + 60, 60, 38), fn: hsl(h + 25, 75, 32), str: hsl(h + 150, 55, 28), num: hsl(h - 40, 70, 38), com: hsl(h, 8, 45),
      param: hsl(h + 100, 50, 32), type: hsl(h + 180, 55, 28), punct: hsl(h, 10, 42), err: "#b4441f", ok: "#2d6e3a",
    };
  }
  return {
    light: false,
    bg: hsl(h, tint, 7), island: hsl(h, tint, 11), panel: hsl(h, tint, 17), line: hsl(h, tint, 19), code: hsl(h, tint, 8.5),
    text: hsl(h, 15, 89), muted: hsl(h, 12, 62), strong: "#ffffff", accent: hsl(h, sat, 66), onAccent: hsl(h, 40, 10), selection: hsl(h, 35, 25),
    kw: hsl(h + 60, 70, 77), fn: hsl(h + 25, 85, 70), str: hsl(h + 150, 55, 72), num: hsl(h - 40, 80, 74), com: hsl(h, 12, 55),
    param: hsl(h + 100, 60, 80), type: hsl(h + 180, 50, 66), punct: hsl(h, 12, 62), err: "#ff8d8d", ok: "#6fd3a8",
  };
}

/** Оттенок темы «Из фоновой картинки» — из настройки tulpar.photoTheme. */
function photo(): PhotoTheme {
  const t = settings()["tulpar.photoTheme"] as PhotoTheme | null | undefined;
  return t && Number.isFinite(t.hue) ? t : { hue: 40, sat: 70, light: false };
}

function pal(id: string): Palette | undefined {
  if (id === "photo") return photoPalette(photo());
  if (id.startsWith("ext:")) return extThemes().get(id)?.palette;
  if (id.startsWith("custom:")) return customPalette(id);
  return PALETTES[id as keyof typeof PALETTES];
}

function customPalette(id: string): Palette | undefined {
  const t = ((settings()["tulpar.customThemes"] ?? {}) as Record<string, { palette: Record<string, string | boolean> }>)[id.slice("custom:".length)];
  if (!t) return undefined;
  // Недостающие цвета берём из «Ночной степи» — старые файлы тем не ломаются
  return { ...PALETTES.steppe, ...(t.palette as Partial<Palette>) } as Palette;
}

/** Палитра любой темы (для галереи и редактора тем). Для классических — ближайшая своя. */
export function paletteOf(id: string): Palette {
  return pal(id) ?? (id === "light" ? PALETTES.dawn : PALETTES.steppe);
}

export const BASE_PALETTES = PALETTES;

/** Главный оттенок картинки: 24 корзины оттенка, вес = насыщенность × близость яркости к 55%. */
export function photoThemeFromPixels(data: Uint8ClampedArray): PhotoTheme {
  const weight = new Float64Array(24);
  const satSum = new Float64Array(24);
  let lightSum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    lightSum += l;
    count++;
    const d = max - min;
    if (d < 0.02) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const w = s * Math.max(0, 1 - Math.abs(l - 0.55) * 2);
    const bin = Math.floor(h / 15) % 24;
    weight[bin] += w;
    satSum[bin] += s * w;
  }
  let best = 0;
  for (let i = 1; i < 24; i++) {
    // Соседние корзины тоже считаются — оттенок на границе не теряется
    const score = (j: number) => weight[j] + 0.5 * (weight[(j + 23) % 24] + weight[(j + 1) % 24]);
    if (score(i) > score(best)) best = i;
  }
  const w = weight[best];
  const sat = w > 0 ? Math.round((satSum[best] / w) * 100) : 40;
  return { hue: best * 15 + 7, sat, light: count > 0 && lightSum / count > 0.72 };
}

export function isLightTheme(id: string): boolean {
  if (id === "light") return true;
  return pal(id)?.light ?? false;
}

/** Имя темы Monaco для настройки workbench.colorTheme. */
let definedPhoto = "";
const definedExt = new Map<string, unknown>();

export function monacoTheme(id: string): string {
  if (id === "photo") {
    // Оттенок мог смениться — переопределяем тему Monaco
    const key = JSON.stringify(photo());
    if (key !== definedPhoto) definePhotoMonacoTheme();
    return "tulpar-photo";
  }
  if (id in PALETTES) return `tulpar-${id}`;
  if (id.startsWith("custom:")) {
    const p = customPalette(id);
    if (p) {
      const name = "tulpar-" + id.replace(/[^a-zA-Z0-9]+/g, "-");
      const key = JSON.stringify(p);
      if (definedExt.get(name) !== key) {
        defineOne(name.slice("tulpar-".length), p);
        definedExt.set(name, key);
      }
      return name;
    }
  }
  const ext = extThemes().get(id);
  if (ext) {
    const name = "tulpar-" + id.replace(/[^a-zA-Z0-9]+/g, "-");
    if (definedExt.get(name) !== ext) {
      defineOne(name.slice("tulpar-".length), ext.palette, ext.monaco);
      definedExt.set(name, ext);
    }
    return name;
  }
  return id === "light" ? "vs" : "vs-dark";
}

const strip = (hex: string) => hex.replace("#", "");

/** Зарегистрировать темы Tulpar в Monaco — один раз при запуске. */
export function defineMonacoThemes() {
  for (const [id, p] of Object.entries(PALETTES)) defineOne(id, p);
  definePhotoMonacoTheme();
}

function definePhotoMonacoTheme() {
  definedPhoto = JSON.stringify(photo());
  defineOne("photo", photoPalette(photo()));
}

function defineOne(id: string, p: Palette, extra: Record<string, string> = {}) {
  {
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
        ...extra,
      },
    });
  }
}

/** CSS-переменные интерфейса для тем Tulpar (классические темы — в base.css). */
export function cssVars(id: string): Record<string, string> | null {
  const p = pal(id);
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
  const p = pal(id);
  if (!p) return null;
  const own = extThemes().get(id)?.terminal ?? {};
  return {
    ...terminalBase(p),
    ...own,
  };
}

function terminalBase(p: Palette): ITheme {
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

/** Главные цвета темы — для карточек выбора темы. */
export function themePreview(id: string): { bg: string; island: string; text: string; accent: string; kw: string; str: string } {
  const p = pal(id);
  if (p) return { bg: p.bg, island: p.island, text: p.text, accent: p.accent, kw: p.kw, str: p.str };
  if (id === "light") return { bg: "#ffffff", island: "#f3f3f3", text: "#333333", accent: "#0078d4", kw: "#0000ff", str: "#a31515" };
  return { bg: "#1e1e1e", island: "#181818", text: "#cccccc", accent: "#0078d4", kw: "#569cd6", str: "#ce9178" };
}
