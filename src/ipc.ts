// Типизированные вызовы ядра на Rust. Интерфейс не трогает диск сам — только через эти функции.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ChangeEvent {
  kind: "create" | "modify" | "remove";
  paths: string[];
}

export type ConfigName = "settings.json" | "keybindings.json" | "layout.json";

export const core = {
  workspaceOpen: (path: string) => invoke<string>("workspace_open", { path }),
  workspaceRoot: () => invoke<string | null>("workspace_root"),
  readDir: (path: string) => invoke<DirEntry[]>("read_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, content: string) => invoke<void>("write_file", { path, content }),
  listFiles: () => invoke<string[]>("list_files"),
  configRead: (name: ConfigName) => invoke<string | null>("config_read", { name }),
  configDir: () => invoke<string>("config_dir"),
  configEnsure: (name: ConfigName) => invoke<string>("config_ensure", { name }),
};

export const events = {
  onWorkspaceChanged: (cb: (e: ChangeEvent) => void): Promise<UnlistenFn> =>
    listen<ChangeEvent>("workspace:changed", (e) => cb(e.payload)),
  onConfigChanged: (cb: (name: ConfigName) => void): Promise<UnlistenFn> =>
    listen<{ name: ConfigName }>("config:changed", (e) => cb(e.payload.name)),
};

/** Соединяет корень и относительный путь с правильным разделителем для ОС. */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}

/** Имя файла из полного пути. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
