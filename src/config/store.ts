// Настройки, сочетания клавиш и раскладка. Значения по умолчанию + файлы пользователя,
// перечитываются на лету при каждом изменении файла.
import { createSignal } from "solid-js";
import { core, events, type ConfigName } from "../ipc";
import { parseJsonc } from "./jsonc";
import { notify } from "../app/notify";

// ---------- settings.json (ключи совместимы с VS Code) ----------

export interface Settings {
  "editor.fontSize": number;
  "editor.fontFamily": string;
  "editor.lineHeight": number;
  "editor.tabSize": number;
  "editor.insertSpaces": boolean;
  "editor.wordWrap": "off" | "on";
  "editor.minimap.enabled": boolean;
  "editor.lineNumbers": "on" | "off" | "relative";
  "editor.cursorBlinking": "blink" | "smooth" | "phase" | "expand" | "solid";
  "workbench.colorTheme": "dark" | "light";
  "files.autoSave": "off" | "afterDelay" | "onFocusChange";
  "files.autoSaveDelay": number;
  /** Оболочка терминала; null — PowerShell на Windows, $SHELL на macOS и Linux */
  "terminal.integrated.shell": string | null;
  "terminal.integrated.fontSize": number;
  [key: string]: unknown;
}

export const defaultSettings: Settings = {
  "editor.fontSize": 14,
  "editor.fontFamily": "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
  "editor.lineHeight": 0,
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.wordWrap": "off",
  "editor.minimap.enabled": true,
  "editor.lineNumbers": "on",
  "editor.cursorBlinking": "smooth",
  "workbench.colorTheme": "dark",
  "files.autoSave": "off",
  "files.autoSaveDelay": 1000,
  "terminal.integrated.shell": null,
  "terminal.integrated.fontSize": 13,
};

// ---------- keybindings.json (формат VS Code) ----------

export interface Keybinding {
  key: string;
  command: string;
  args?: unknown;
}

// ---------- layout.json ----------

export type Slot = "left" | "center" | "bottom" | "right";
export type LayoutDef = Partial<Record<Slot, string[]>>;

export interface LayoutConfig {
  layouts: Record<string, LayoutDef>;
  default: string;
}

export const defaultLayout: LayoutConfig = {
  layouts: {
    "Код": { left: ["explorer"], center: ["editor"], bottom: ["terminal"] },
    "Фокус": { center: ["editor"] },
  },
  default: "Код",
};

// ---------- languages.json ----------

export interface ServerConfig {
  command: string;
  args?: string[];
  /** Подсказка, как установить сервер, если его нет */
  install?: string;
}

/** Ключ — id языка в Monaco. TypeScript и JavaScript по умолчанию обслуживает
 *  встроенный в Monaco движок, поэтому сервер для них не нужен. */
export const defaultLanguages: Record<string, ServerConfig | null> = {
  rust: { command: "rust-analyzer", install: "rustup component add rust-analyzer" },
  python: { command: "basedpyright-langserver", args: ["--stdio"], install: "pip install basedpyright" },
  go: { command: "gopls", install: "go install golang.org/x/tools/gopls@latest" },
  c: { command: "clangd", install: "установите clangd (LLVM)" },
  cpp: { command: "clangd", install: "установите clangd (LLVM)" },
};

// ---------- состояние ----------

const [settings, setSettings] = createSignal<Settings>(defaultSettings);
const [userKeybindings, setUserKeybindings] = createSignal<Keybinding[]>([]);
const [layoutConfig, setLayoutConfig] = createSignal<LayoutConfig>(defaultLayout);
const [activeLayout, setActiveLayout] = createSignal<string>(defaultLayout.default);
const [languages, setLanguages] = createSignal<Record<string, ServerConfig | null>>(defaultLanguages);

export { settings, userKeybindings, layoutConfig, activeLayout, setActiveLayout, languages };

export function setting<K extends keyof Settings>(key: K): Settings[K] {
  return settings()[key];
}

async function readConfig<T>(name: ConfigName): Promise<T | null> {
  const text = await core.configRead(name);
  if (text === null || text.trim() === "") return null;
  try {
    return parseJsonc<T>(text);
  } catch (e) {
    notify(`Ошибка в ${name}: ${e instanceof Error ? e.message : e}`, "error");
    return null;
  }
}

async function load(name: ConfigName) {
  switch (name) {
    case "settings.json": {
      const user = await readConfig<Partial<Settings>>(name);
      setSettings({ ...defaultSettings, ...(user ?? {}) });
      break;
    }
    case "keybindings.json": {
      const user = await readConfig<Keybinding[]>(name);
      setUserKeybindings(Array.isArray(user) ? user : []);
      break;
    }
    case "layout.json": {
      const user = await readConfig<Partial<LayoutConfig>>(name);
      const merged: LayoutConfig = {
        layouts: { ...defaultLayout.layouts, ...(user?.layouts ?? {}) },
        default: user?.default ?? defaultLayout.default,
      };
      setLayoutConfig(merged);
      if (!merged.layouts[activeLayout()]) setActiveLayout(merged.default);
      break;
    }
    case "languages.json": {
      const user = await readConfig<Record<string, ServerConfig | null>>(name);
      setLanguages({ ...defaultLanguages, ...(user ?? {}) });
      break;
    }
  }
}

/** Загрузить всё при старте и подписаться на изменения файлов. */
export async function initConfig() {
  const names: ConfigName[] = ["settings.json", "keybindings.json", "layout.json", "languages.json"];
  await Promise.all(names.map((n) => load(n).catch(() => undefined)));
  setActiveLayout(layoutConfig().default);
  await events.onConfigChanged((name) => {
    load(name).then(() => notify(`${name} применён`));
  });
}
