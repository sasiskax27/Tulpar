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
  | { kind: "web"; path: string; url: string }
  | { kind: "text"; path: string; title: string; text: string; language: string };

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
