// Настройки, сочетания клавиш и раскладка. Значения по умолчанию + файлы пользователя,
// перечитываются на лету при каждом изменении файла.
import { createSignal } from "solid-js";
import { core, events, type ConfigName } from "../ipc";
import { parseJsonc } from "./jsonc";
import { notify, notifyError } from "../app/notify";

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
  "editor.cursorStyle": "line" | "block" | "underline" | "line-thin";
  /** Лигатуры шрифта (=> != ===), если шрифт их поддерживает */
  "editor.fontLigatures": boolean;
  "editor.renderWhitespace": "none" | "selection" | "boundary" | "all";
  /** Строка с началом функции/класса прилипает к верху при прокрутке */
  "editor.stickyScroll.enabled": boolean;
  /** Парные скобки разными цветами */
  "editor.bracketPairColorization.enabled": boolean;
  "editor.smoothScrolling": boolean;
  /** Вертикальные линии-ограничители, например "80, 120" */
  "editor.rulers": string;
  "editor.autoClosingBrackets": "always" | "languageDefined" | "never";
  /** Ctrl + колесо мыши меняет размер шрифта */
  "editor.mouseWheelZoom": boolean;
  /** Форматировать файл при сохранении (через языковой сервер) */
  "editor.formatOnSave": boolean;
  "editor.guides.indentation": boolean;
  "editor.folding": boolean;
  "files.trimTrailingWhitespace": boolean;
  "files.insertFinalNewline": boolean;
  "terminal.integrated.fontFamily": string;
  "terminal.integrated.cursorStyle": "block" | "underline" | "bar";
  "terminal.integrated.scrollback": number;
  "workbench.colorTheme": "steppe" | "berkut" | "dawn" | "photo" | "dark" | "light";
  /** Дизайн 1 (classic) или Дизайн 2 (tulpar: верхняя панель и выезжающий остров) */
  "workbench.style": "classic" | "tulpar";
  /** Панели — отдельные скруглённые острова с промежутками */
  "workbench.islands": boolean;
  /** Где полоса иконок в Дизайне 1 */
  "workbench.activityBar": "left" | "right" | "hidden";
  /** Вид вкладок */
  "workbench.tabs.style": "pills" | "underline" | "classic";
  /** Скругление углов, px */
  "workbench.radius": number;
  /** Размер шрифта интерфейса, px */
  "workbench.uiFontSize": number;
  /** Отступ между островами, px */
  "workbench.gap": number;
  "workbench.statusBar.visible": boolean;
  /** Дизайн 2: боковой остров прячется сам и выезжает при наведении на левый край */
  "workbench.sidebar.autoHide": boolean;
  "files.autoSave": "off" | "afterDelay" | "onFocusChange";
  "files.autoSaveDelay": number;
  /** Оболочка терминала; null — PowerShell на Windows, $SHELL на macOS и Linux */
  "terminal.integrated.shell": string | null;
  "terminal.integrated.fontSize": number;
  /** Оттенок темы «Из фоновой картинки», вычисляется из картинки */
  "tulpar.photoTheme": { hue: number; sat: number; light: boolean } | null;
  /** Фоновая картинка: путь к файлу или null */
  "tulpar.background.image": string | null;
  "tulpar.background.opacity": number;
  "tulpar.background.blur": number;
  "tulpar.background.fit": "cover" | "contain" | "center" | "tile";
  /** overlay — слой поверх окна; behind — фон под окном, панели полупрозрачные */
  "tulpar.background.mode": "overlay" | "behind";
  /** Непрозрачность панелей в режиме «за панелями», 0.3…1 */
  "workbench.panelOpacity": number;
  /** Размытие под панелями («стекло»), px */
  "workbench.panelBlur": number;
  "tulpar.ai.provider": "none" | "ollama" | "openai" | "opencode" | "openrouter" | "anthropic";
  "tulpar.ai.baseUrl": string;
  "tulpar.ai.model": string;
  "tulpar.ai.apiKey": string;
  /** На каком языке ИИ пишет комментарии и объяснения */
  "tulpar.ai.language": string;
  /** Подсказки ИИ при наборе (серый текст, Tab — принять) */
  "tulpar.ai.inline": boolean;
  /** Откуда брать подсказки при наборе: модель ИИ из настроек или GitHub Copilot */
  "tulpar.ai.inlineProvider": "model" | "copilot";
  /** Отдельная быстрая модель для подсказок; пусто — та же, что для действий */
  "tulpar.ai.inlineModel": string;
  /** Ollama: память модели в токенах (больше — помнит больше, но нужно больше памяти компьютера) */
  "tulpar.ai.contextSize": number;
  /** Сколько символов кода проекта отдавать ИИ в режиме «Весь проект» */
  "tulpar.ai.projectChars": number;
  /** Проверять новую версию Tulpar на GitHub (раз в 12 часов, один запрос без данных о вас) */
  "tulpar.update.check": boolean;
  /** Агент: что спрашивать перед действием. ask — правки и команды, edits — только команды, all — ничего */
  "tulpar.agent.approve": "ask" | "edits" | "all";
  /** Сколько шагов агент может сделать за одну задачу */
  "tulpar.agent.maxSteps": number;
  /** Где живёт чат с ИИ: внизу рядом с терминалом или в боковой панели */
  "tulpar.chat.location": "bottom" | "sidebar";
  /** Свои действия ИИ в меню по правому клику */
  "tulpar.ai.customActions": CustomAiAction[];
  [key: string]: unknown;
}

export interface CustomAiAction {
  name: string;
  prompt: string;
  /** replace — заменить код ответом; show — показать ответ в окне */
  mode: "replace" | "show";
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
  "editor.cursorStyle": "line",
  "editor.fontLigatures": true,
  "editor.renderWhitespace": "selection",
  "editor.stickyScroll.enabled": true,
  "editor.bracketPairColorization.enabled": true,
  "editor.smoothScrolling": true,
  "editor.rulers": "",
  "editor.autoClosingBrackets": "languageDefined",
  "editor.mouseWheelZoom": true,
  "editor.formatOnSave": false,
  "editor.guides.indentation": true,
  "editor.folding": true,
  "files.trimTrailingWhitespace": false,
  "files.insertFinalNewline": false,
  "terminal.integrated.fontFamily": "",
  "terminal.integrated.cursorStyle": "block",
  "terminal.integrated.scrollback": 5000,
  "workbench.colorTheme": "steppe",
  "workbench.style": "classic",
  "workbench.islands": true,
  "workbench.activityBar": "left",
  "workbench.tabs.style": "pills",
  "workbench.radius": 10,
  "workbench.uiFontSize": 13,
  "workbench.gap": 6,
  "workbench.statusBar.visible": true,
  "workbench.sidebar.autoHide": true,
  "files.autoSave": "off",
  "files.autoSaveDelay": 1000,
  "terminal.integrated.shell": null,
  "terminal.integrated.fontSize": 13,
  "tulpar.photoTheme": null,
  "tulpar.background.image": null,
  "tulpar.background.opacity": 0.15,
  "tulpar.background.blur": 0,
  "tulpar.background.fit": "cover",
  "tulpar.background.mode": "behind",
  "workbench.panelOpacity": 0.78,
  "workbench.panelBlur": 14,
  "tulpar.ai.provider": "none",
  "tulpar.ai.baseUrl": "",
  "tulpar.ai.model": "",
  "tulpar.ai.apiKey": "",
  "tulpar.ai.language": "русский",
  "tulpar.ai.inline": false,
  "tulpar.ai.inlineProvider": "model",
  "tulpar.chat.location": "bottom",
  "tulpar.ai.contextSize": 16384,
  "tulpar.update.check": true,
  "tulpar.agent.approve": "ask",
  "tulpar.agent.maxSteps": 30,
  "tulpar.ai.inlineModel": "",
  "tulpar.ai.customActions": [],
  "tulpar.ai.projectChars": 60000,
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
  /** Запасные серверы: если основной не установлен или падает, пробуем их по очереди */
  alternatives?: ServerConfig[];
}

/** Ключ — id языка в Monaco. TypeScript и JavaScript по умолчанию обслуживает
 *  встроенный в Monaco движок, поэтому сервер для них не нужен. */
/** Команда установки под текущую ОС. */
function byOs(cmds: { win?: string; mac?: string; linux?: string; all?: string }): string | undefined {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return cmds.win ?? cmds.all;
  if (ua.includes("Mac")) return cmds.mac ?? cmds.all;
  return cmds.linux ?? cmds.all;
}

const clangd: ServerConfig = {
  command: "clangd",
  install: byOs({ win: "winget install LLVM.LLVM", mac: "brew install llvm", linux: "sudo apt install clangd" }),
};

export const defaultLanguages: Record<string, ServerConfig | null> = {
  rust: { command: "rust-analyzer", install: "rustup component add rust-analyzer" },
  python: {
    command: "basedpyright-langserver",
    args: ["--stdio"],
    install: "npm install -g basedpyright",
    alternatives: [
      { command: "pyright-langserver", args: ["--stdio"], install: "npm install -g pyright" },
      { command: "jedi-language-server", install: "pip install -U jedi-language-server" },
      { command: "pylsp", install: "pip install -U python-lsp-server" },
    ],
  },
  go: { command: "gopls", install: "go install golang.org/x/tools/gopls@latest" },
  c: clangd,
  cpp: clangd,
  "objective-c": clangd,
  java: {
    command: "jdtls",
    install: byOs({ win: "scoop install jdtls", mac: "brew install jdtls", linux: "brew install jdtls" }),
  },
  csharp: { command: "csharp-ls", install: "dotnet tool install --global csharp-ls" },
  php: { command: "intelephense", args: ["--stdio"], install: "npm install -g intelephense" },
  lua: {
    command: "lua-language-server",
    install: byOs({ win: "winget install LuaLS.lua-language-server", mac: "brew install lua-language-server", linux: "brew install lua-language-server" }),
  },
  kotlin: {
    command: "kotlin-language-server",
    install: byOs({ win: "scoop install kotlin-language-server", mac: "brew install kotlin-language-server", linux: "brew install kotlin-language-server" }),
  },
  ruby: { command: "ruby-lsp", install: "gem install ruby-lsp" },
  scala: { command: "metals", install: "cs install metals" },
  dart: { command: "dart", args: ["language-server", "--protocol=lsp"] },
  swift: { command: "sourcekit-lsp" },
  r: { command: "R", args: ["--slave", "-e", "languageserver::run()"], install: `Rscript -e "install.packages('languageserver', repos='https://cloud.r-project.org')"` },
  shell: { command: "bash-language-server", args: ["start"], install: "npm install -g bash-language-server" },
  yaml: { command: "yaml-language-server", args: ["--stdio"], install: "npm install -g yaml-language-server" },
  dockerfile: { command: "docker-langserver", args: ["--stdio"], install: "npm install -g dockerfile-language-server-nodejs" },
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

// ---------- изменение настроек из интерфейса ----------

let pendingChanges: Record<string, unknown> = {};
let persistTimer: number | undefined;
let lastOwnWrite = 0;

/** Изменить настройку: применяется сразу, а в settings.json записывается чуть позже,
 *  чтобы не писать файл на каждое движение ползунка. */
export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  setSettings((s) => ({ ...s, [key]: value }));
  pendingChanges[key as string] = value;
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => void persistSettings(), 300);
}

async function persistSettings() {
  const changes = pendingChanges;
  pendingChanges = {};
  try {
    const path = await core.configEnsure("settings.json");
    const text = await core.configRead("settings.json");
    let current: Record<string, unknown>;
    try {
      current = text && text.trim() ? parseJsonc<Record<string, unknown>>(text) : {};
    } catch {
      // Файл с ошибкой не перезаписываем — иначе потеряем то, что в нём написано
      notify("В settings.json ошибка, изменения не сохранены. Исправьте файл.", "error");
      return;
    }
    for (const [key, value] of Object.entries(changes)) {
      // Значения по умолчанию в файле не держим
      if (value === defaultSettings[key]) delete current[key];
      else current[key] = value;
    }
    lastOwnWrite = Date.now();
    await core.writeFile(path, JSON.stringify(current, null, 2) + "\n");
  } catch (e) {
    notifyError("Не удалось сохранить настройки", e);
  }
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
      setSettings({ ...defaultSettings, ...(user ?? {}), ...pendingChanges });
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
    // О собственной записи из окна настроек не сообщаем
    const own = name === "settings.json" && Date.now() - lastOwnWrite < 2000;
    void load(name).then(() => {
      if (!own) notify(`${name} применён`);
    });
  });
}
