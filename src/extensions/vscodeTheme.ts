// Цветовая тема VS Code → палитра Tulpar. У тем VS Code сотни ключей; нам нужны
// главные цвета окна и по одному цвету на каждый вид кода (ключевые слова,
// строки, комментарии…). Цвета самого редактора кода берутся из темы как есть.

export interface VsTheme {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: { scope?: string | string[]; settings?: { foreground?: string; fontStyle?: string } }[];
}

export interface Palette {
  light: boolean;
  bg: string; island: string; panel: string; line: string; code: string;
  text: string; muted: string; strong: string; accent: string; onAccent: string; selection: string;
  kw: string; fn: string; str: string; num: string; com: string; param: string; type: string; punct: string;
  err: string; ok: string;
}

type Rgb = [number, number, number, number];

function parse(c: string | undefined): Rgb | null {
  if (!c) return null;
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** Цвет в #rrggbb; полупрозрачный — смешиваем с подложкой. */
export function solid(c: string | undefined, under = "#000000"): string | null {
  const a = parse(c);
  if (!a) return null;
  const b = parse(under) ?? [0, 0, 0, 1];
  const k = a[3];
  return hex(a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k), a[2] * k + b[2] * (1 - k));
}

export function mix(a: string, b: string, t: number): string {
  const x = parse(a)!, y = parse(b)!;
  return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

function luminance(c: string): number {
  const [r, g, b] = parse(c) ?? [0, 0, 0, 1];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Цвет токена по области TextMate: побеждает самая точная подходящая область. */
export function scopeColor(theme: VsTheme, candidates: string[]): string | undefined {
  const rules = theme.tokenColors ?? [];
  for (const want of candidates) {
    let best: string | undefined;
    let bestLen = -1;
    for (const r of rules) {
      const fg = r.settings?.foreground;
      if (!fg || !r.scope) continue;
      const scopes = Array.isArray(r.scope) ? r.scope : r.scope.split(",");
      for (const raw of scopes) {
        const s = raw.trim();
        if (!s || s.includes(" ")) continue; // «a b» — вложенные селекторы, их не разбираем
        if ((want === s || want.startsWith(s + ".")) && s.length > bestLen) {
          best = fg;
          bestLen = s.length;
        }
      }
    }
    if (best) return best;
  }
  return undefined;
}

export function paletteFromVsTheme(theme: VsTheme, uiTheme: string): Palette {
  const c = theme.colors ?? {};
  const light = uiTheme === "vs" || uiTheme === "hc-light" || theme.type === "light";
  const code = solid(c["editor.background"]) ?? (light ? "#ffffff" : "#1e1e1e");
  const pick = (keys: string[], under = code) => {
    for (const k of keys) {
      const v = solid(c[k], under);
      if (v) return v;
    }
    return null;
  };
  const text = pick(["editor.foreground", "foreground"]) ?? (light ? "#333333" : "#cccccc");
  const island = pick(["sideBar.background", "editorGroupHeader.tabsBackground", "panel.background"]) ?? mix(code, light ? "#000000" : "#000000", 0.08);
  const bg = pick(["activityBar.background", "titleBar.activeBackground", "editorGroupHeader.tabsBackground"]) ?? island;
  const panel = pick(["list.hoverBackground", "editorWidget.background", "input.background"], island) ?? mix(island, text, 0.08);
  const line = pick(["sideBar.border", "editorGroup.border", "panel.border", "contrastBorder"], island) ?? mix(island, text, 0.12);
  const muted = pick(["descriptionForeground", "editorLineNumber.foreground", "tab.inactiveForeground"]) ?? mix(text, code, 0.4);
  // Акцент — только непрозрачный цвет, иначе кнопки выйдут блёклыми
  const opaque = (keys: string[]) => keys.map((k) => c[k]).find((v) => (parse(v)?.[3] ?? 0) > 0.9);
  const accent = solid(opaque(["button.background", "activityBarBadge.background", "focusBorder", "textLink.foreground", "progressBar.background"])) ?? (light ? "#0066b8" : "#4daafc");
  const onAccent = pick(["button.foreground", "activityBarBadge.foreground"], accent) ?? (luminance(accent) > 0.55 ? "#111111" : "#ffffff");
  const selection = pick(["editor.selectionBackground", "list.activeSelectionBackground"]) ?? mix(code, accent, 0.3);

  const token = (scopes: string[], fallback: string) => solid(scopeColor(theme, scopes), code) ?? fallback;
  const defaultFg = solid((theme.tokenColors ?? []).find((r) => !r.scope && r.settings?.foreground)?.settings?.foreground, code) ?? text;

  return {
    light,
    bg, island, panel, line, code,
    text, muted, strong: light ? "#000000" : "#ffffff", accent, onAccent, selection,
    kw: token(["keyword.control", "keyword", "storage.type"], light ? "#af00db" : "#c586c0"),
    fn: token(["entity.name.function", "support.function"], light ? "#795e26" : "#dcdcaa"),
    str: token(["string.quoted", "string"], light ? "#a31515" : "#ce9178"),
    num: token(["constant.numeric", "constant.language", "constant"], light ? "#098658" : "#b5cea8"),
    com: token(["comment.line", "comment"], light ? "#008000" : "#6a9955"),
    param: token(["variable.parameter", "variable.other", "variable"], defaultFg),
    type: token(["entity.name.type", "support.type", "entity.name.class", "support.class"], light ? "#267f99" : "#4ec9b0"),
    punct: token(["punctuation.separator", "punctuation"], defaultFg),
    err: pick(["errorForeground", "editorError.foreground"]) ?? "#f14c4c",
    ok: pick(["gitDecoration.addedResourceForeground", "terminal.ansiGreen"]) ?? "#73c991",
  };
}

/** Цвета редактора Monaco прямо из темы (ключи у Monaco и VS Code общие). */
export function monacoColors(theme: VsTheme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {})) {
    if (typeof v !== "string" || !/^#[0-9a-f]{3,8}$/i.test(v)) continue;
    if (/^(editor|editorLineNumber|editorCursor|editorWhitespace|editorIndentGuide|editorBracket|editorWidget|editorSuggestWidget|editorHoverWidget|editorGutter|editorError|editorWarning|editorInfo|editorGhostText|minimap|scrollbar|diffEditor|peekView|stickyScroll)/.test(k)) {
      out[k] = v;
    }
  }
  return out;
}

/** Цвета терминала из темы, если она их задаёт. */
export function terminalColors(theme: VsTheme): Record<string, string> {
  const c = theme.colors ?? {};
  const out: Record<string, string> = {};
  const names = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"];
  for (const n of names) {
    const lower = n.toLowerCase();
    const normal = solid(c[`terminal.ansi${n}`]);
    const bright = solid(c[`terminal.ansiBright${n}`]);
    if (normal) out[lower] = normal;
    if (bright) out[`bright${n}`] = bright;
  }
  const bg = solid(c["terminal.background"]);
  const fg = solid(c["terminal.foreground"]);
  if (bg) out.background = bg;
  if (fg) out.foreground = fg;
  return out;
}
