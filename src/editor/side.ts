// Правая половина редактора: второй файл рядом, предпросмотр Markdown и HTML,
// просмотр картинок и видео.
import { createSignal } from "solid-js";
import { activePath, loadModel } from "./tabs";
import { notify } from "../app/notify";

export type SideView =
  | { kind: "editor"; path: string }
  | { kind: "markdown"; path: string }
  | { kind: "html"; path: string }
  | { kind: "media"; path: string }
  | { kind: "sqlite"; path: string }
  | { kind: "notebook"; path: string }
  | { kind: "learn"; path: string }
  | { kind: "map"; path: string }
  | { kind: "variants"; path: string }
  | { kind: "tool"; path: string; tool: ToolId }
  | { kind: "db"; path: string; connId: string; schema?: string; table?: string }
  | { kind: "web"; path: string; url: string }
  | { kind: "text"; path: string; title: string; text: string; language: string };

export type ToolId = "http" | "regex" | "todo" | "history" | "stats" | "toolbox";

const TOOL_TITLES: Record<ToolId, string> = {
  http: "🌐 Запросы",
  regex: "🔣 Регулярки",
  todo: "📋 Доска TODO",
  history: "⏳ Машина времени",
  stats: "📊 Моя статистика",
  toolbox: "🧰 Инструменты",
};

/** Встроенный инструмент справа: HTTP-клиент, регулярки, TODO и т. д. */
export function showTool(tool: ToolId) {
  setSide({ kind: "tool", path: TOOL_TITLES[tool], tool });
}

const [side, setSide] = createSignal<SideView | null>(null);
export { side, setSide };

const MEDIA_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|mp4|webm)$/i;
const MARKDOWN_RE = /\.(md|mdx|markdown)$/i;
const HTML_RE = /\.html?$/i;

export const isMedia = (path: string) => MEDIA_RE.test(path);
export const isMarkdown = (path: string | null) => !!path && MARKDOWN_RE.test(path);
export const isHtml = (path: string | null) => !!path && HTML_RE.test(path);

function current(): string | null {
  const p = activePath();
  return p && !p.startsWith("diff:") ? p : null;
}

/** Открыть текущий (или указанный) файл справа — второй редактор. */
export async function splitEditor(path = current()) {
  if (!path) {
    notify("Откройте файл, который хотите видеть рядом");
    return;
  }
  await loadModel(path);
  setSide({ kind: "editor", path });
}

export function previewMarkdown(path = current()) {
  if (!path || !isMarkdown(path)) {
    notify("Предпросмотр работает для файлов .md");
    return;
  }
  setSide({ kind: "markdown", path });
}

export function previewHtml(path = current()) {
  if (!path || !isHtml(path)) {
    notify("Предпросмотр работает для файлов .html");
    return;
  }
  setSide({ kind: "html", path });
}

export const isSqlite = (path: string) => /\.(db|sqlite|sqlite3|db3)$/i.test(path);

/** Таблица или коллекция серверной базы справа. path — подпись для заголовка. */
export function showDb(connId: string, title: string, schema?: string, table?: string) {
  setSide({ kind: "db", path: title, connId, schema, table });
}

export function showVariants() {
  setSide({ kind: "variants", path: "Три варианта" });
}

export function showProjectMap() {
  setSide({ kind: "map", path: "Карта проекта" });
}

export function showLearn() {
  setSide({ kind: "learn", path: "Учебный режим" });
}

export function showNotebook(path: string) {
  setSide({ kind: "notebook", path });
}

export function showSqlite(path: string) {
  setSide({ kind: "sqlite", path });
}

/** Сайт с локального dev-сервера справа (живой предпросмотр). */
export function showWeb(url: string) {
  setSide({ kind: "web", path: url, url });
}

export function showMedia(path: string) {
  setSide({ kind: "media", path });
}

export function closeSide() {
  setSide(null);
}

/** Показать справа текст только для чтения (например, изменения коммита). */
export function showText(title: string, text: string, language = "plaintext") {
  setSide({ kind: "text", path: title, title, text, language });
}
