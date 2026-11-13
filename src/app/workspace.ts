// Открытая папка проекта и реакция на изменения файлов на диске.
import { createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { core, events } from "../ipc";
import { closeAll, onDiskChange, setSessionRoot } from "../editor/tabs";
import { notifyError } from "./notify";

const [root, setRoot] = createSignal<string | null>(null);
export { root };

/** Обработчики, которые перечитывают папку в дереве файлов. Ключ — путь папки. */
const dirReloaders = new Map<string, () => void>();

export function onDirChanged(dir: string, reload: () => void): () => void {
  dirReloaders.set(dir, reload);
  return () => {
    if (dirReloaders.get(dir) === reload) dirReloaders.delete(dir);
  };
}

function parentDir(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

let pendingDirs = new Set<string>();
let flushTimer: number | undefined;

export async function initWorkspaceEvents() {
  await events.onWorkspaceChanged((e) => {
    for (const p of e.paths) {
      if (e.kind === "modify") void onDiskChange(p);
      pendingDirs.add(parentDir(p));
    }
    // Собираем пачку событий за 100 мс, чтобы не перечитывать папку на каждый файл
    clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      for (const dir of pendingDirs) dirReloaders.get(dir)?.();
      pendingDirs = new Set();
    }, 100);
  });
}

export async function openFolder(path?: string) {
  const chosen = path ?? (await open({ directory: true, multiple: false, title: "Открыть папку" }));
  if (!chosen || Array.isArray(chosen)) return false;
  try {
    const canonical = await core.workspaceOpen(chosen);
    if (root() && root() !== canonical) await closeAll();
    setRoot(canonical);
    setSessionRoot(canonical);
    return true;
  } catch (e) {
    notifyError("Не удалось открыть папку", e);
    return false;
  }
}
