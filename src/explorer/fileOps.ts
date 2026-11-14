// Действия с файлами из проводника: создать, переименовать, удалить.
// Вкладки следуют за файлами: при переименовании переоткрываются по новому пути,
// при удалении закрываются.
import { createSignal } from "solid-js";
import { ask } from "@tauri-apps/plugin-dialog";
import { core, baseName, parentDir, sepOf } from "../ipc";
import { reloadDir } from "../app/workspace";
import { notify, notifyError } from "../app/notify";
import { activePath, closeTab, openFile, setActivePath, tabsUnder } from "../editor/tabs";

export type Editing =
  | { kind: "file" | "folder"; parent: string }
  | { kind: "rename"; path: string }
  | null;

const [editing, setEditing] = createSignal<Editing>(null);
const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
const [selected, setSelected] = createSignal<string | null>(null);
export { editing, setEditing, expanded, selected, setSelected };

export function isExpanded(path: string) {
  return expanded().has(path);
}

export function setFolderOpen(path: string, open: boolean) {
  setExpanded((prev) => {
    const next = new Set(prev);
    if (open) next.add(path);
    else next.delete(path);
    return next;
  });
}

export function collapseAll() {
  setExpanded(new Set<string>());
}

export function startNew(kind: "file" | "folder", parent: string, isRoot: boolean) {
  if (!isRoot) setFolderOpen(parent, true);
  setEditing({ kind, parent });
}

export function startRename(path: string) {
  setEditing({ kind: "rename", path });
}

/** Ввод имени завершён (Enter или потеря фокуса). */
export async function commitEditing(name: string) {
  const state = editing();
  setEditing(null);
  const clean = name.trim();
  if (!state || !clean) return;
  try {
    if (state.kind === "rename") await rename(state.path, clean);
    else await create(state.kind, state.parent, clean);
  } catch (e) {
    notifyError(state.kind === "rename" ? "Не удалось переименовать" : "Не удалось создать", e);
  }
}

async function create(kind: "file" | "folder", parent: string, name: string) {
  const sep = sepOf(parent);
  // «src/utils/helpers.ts» — создаём недостающие папки по пути
  const parts = name.split(/[\\/]/).filter(Boolean);
  let dir = parent;
  for (const part of parts.slice(0, -1)) {
    const next = dir + sep + part;
    await core.createDir(next).catch(() => undefined);
    setFolderOpen(next, true);
    dir = next;
  }
  const path = dir + sep + parts[parts.length - 1];
  if (kind === "file") {
    const created = await core.createFile(path);
    reloadDir(dir);
    setSelected(created);
    await openFile(created);
  } else {
    const created = await core.createDir(path);
    reloadDir(dir);
    setSelected(created);
  }
}

async function rename(from: string, name: string) {
  if (/[\\/]/.test(name)) {
    notify("Имя не может содержать / или \\", "error");
    return;
  }
  if (name === baseName(from)) return;
  const affected = tabsUnder(from);
  if (affected.some((t) => t.dirty)) {
    notify("Сначала сохраните открытые файлы из этой папки", "error");
    return;
  }
  const to = parentDir(from) + sepOf(from) + name;
  const wasActive = activePath();
  const renamed = await core.renamePath(from, to);
  // Вкладки и раскрытые папки — на новый путь
  for (const tab of affected) {
    const next = renamed + tab.path.slice(from.length);
    await closeTab(tab.path, true);
    await openFile(next);
  }
  if (wasActive && affected.some((t) => t.path === wasActive)) {
    setActivePath(renamed + wasActive.slice(from.length));
  }
  setExpanded((prev) => {
    const next = new Set<string>();
    for (const p of prev) next.add(p === from || p.startsWith(from + sepOf(from)) ? renamed + p.slice(from.length) : p);
    return next;
  });
  setSelected(renamed);
  reloadDir(parentDir(from));
}

export async function remove(path: string, isDir: boolean) {
  const affected = tabsUnder(path);
  const dirty = affected.some((t) => t.dirty);
  const ok = await ask(
    `Переместить ${isDir ? "папку" : "файл"} «${baseName(path)}» в корзину?` +
      (dirty ? "\n\nНесохранённые изменения в открытых файлах будут потеряны." : ""),
    { title: "Tulpar", kind: "warning", okLabel: "В корзину", cancelLabel: "Отмена" },
  );
  if (!ok) return;
  try {
    await core.deletePath(path);
    for (const tab of affected) await closeTab(tab.path, true);
    setFolderOpen(path, false);
    if (selected() === path) setSelected(null);
    reloadDir(parentDir(path));
  } catch (e) {
    notifyError("Не удалось удалить", e);
  }
}

export async function copyPath(path: string) {
  try {
    await navigator.clipboard.writeText(path);
    notify("Путь скопирован");
  } catch (e) {
    notifyError("Не удалось скопировать", e);
  }
}
