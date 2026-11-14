// Профиль настроек: один JSON-файл со всеми личными настройками Tulpar.
// Экспорт — «перенести на другой компьютер», импорт — «вернуть как было».
// Ключи API и путь к фоновому файлу в профиль не попадают: они привязаны к машине.
import { core, type ConfigName } from "../ipc";
import { parseJsonc } from "../config/jsonc";
import {
  activeLayout,
  defaultSettings,
  languages,
  layoutConfig,
  replaceConfig,
  settings,
  userKeybindings,
  userSnippets,
  type Keybinding,
  type LayoutConfig,
  type ServerConfig,
  type Settings,
  type UserSnippet,
} from "../config/store";
import { ask, open, saveAs } from "../i18n/dialog";
import { notify, notifyError } from "../app/notify";

/** Ключи, которые нельзя переносить между компьютерами. */
const PRIVATE: (keyof Settings)[] = ["tulpar.ai.apiKey", "tulpar.background.image", "tulpar.photoTheme", "tulpar.databases"];

export interface TulparProfile {
  app: "tulpar-profile";
  version: string;
  exportedAt: string;
  /** Только отличия от стандартных значений */
  settings: Record<string, unknown>;
  keybindings: Keybinding[];
  snippets: Record<string, UserSnippet>;
  layout: LayoutConfig;
  languages: Record<string, ServerConfig | null>;
}

const FILE_FILTERS = [{ name: "Профиль Tulpar", extensions: ["json"] }];

/** Сохранить профиль настройками в файл, выбранный пользователем. */
export async function exportProfile(): Promise<void> {
  try {
    const path = await saveAs({
      title: "Куда сохранить профиль",
      defaultPath: "tulpar-profile.json",
      filters: FILE_FILTERS,
    });
    if (!path) return;
    await core.userFileWrite(path, JSON.stringify(buildProfile(), null, 2) + "\n");
    notify(`Профиль сохранён: ${path}`);
  } catch (e) {
    notifyError("Не удалось экспортировать профиль", e);
  }
}

/** Всё личное в одном объекте — для файла и для синхронизации через GitHub. */
export function buildProfile(): TulparProfile {
  {
    const full: Record<string, unknown> = { ...settings() };
    for (const key of PRIVATE) delete full[key];
    // По умолчанию совпадающее не пишем — профиль компактный и переносимый.
    const slim: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(full)) {
      if (value !== defaultSettings[key as keyof Settings]) slim[key] = value;
    }
    return {
      app: "tulpar-profile",
      version: "0.2.0",
      exportedAt: new Date().toISOString(),
      settings: slim,
      keybindings: userKeybindings(),
      snippets: userSnippets(),
      layout: { ...layoutConfig(), default: activeLayout() },
      languages: languages(),
    };
  }
}

/** Применить профиль из файла: настройки, сочетания, сниппеты, раскладки и языки. */
export async function importProfile(): Promise<void> {
  try {
    const picked = await open({ multiple: false, title: "Файл профиля Tulpar", filters: FILE_FILTERS });
    if (typeof picked !== "string") return;
    let profile: TulparProfile | null = null;
    try {
      profile = parseJsonc<TulparProfile>(await core.userFileRead(picked));
    } catch {
      /* ниже сообщим понятнее */
    }
    if (!profile || profile.app !== "tulpar-profile" || typeof profile.settings !== "object") {
      notifyError("Это не файл профиля Tulpar", picked);
      return;
    }
    await applyProfile(profile);
  } catch (e) {
    notifyError("Не удалось импортировать профиль", e);
  }
}

/** Применить профиль (с подтверждением). */
export async function applyProfile(profile: TulparProfile): Promise<boolean> {
  {
    const date = typeof profile.exportedAt === "string" ? profile.exportedAt.slice(0, 10) : "";
    const ok = await ask(
      `Применить профиль${date ? ` от ${date}` : ""}? Текущие настройки, сочетания клавиш, сниппеты, раскладки и языки будут заменены.`,
      { title: "Импорт профиля", kind: "warning", okLabel: "Применить" },
    );
    if (!ok) return false;

    if (profile.settings && typeof profile.settings === "object") {
      // Свои секреты и локальные пути остаются на этой машине.
      const merged = { ...profile.settings };
      for (const key of PRIVATE) merged[key] = settings()[key];
      await replaceConfig("settings.json", JSON.stringify(merged, null, 2) + "\n");
    }
    const files: [ConfigName, unknown][] = [
      ["keybindings.json", Array.isArray(profile.keybindings) ? profile.keybindings : []],
      ["snippets.json", profile.snippets && typeof profile.snippets === "object" ? profile.snippets : {}],
      ["layout.json", profile.layout && typeof profile.layout === "object" ? { layouts: profile.layout.layouts ?? {}, default: profile.layout.default } : null],
      ["languages.json", profile.languages && typeof profile.languages === "object" ? profile.languages : null],
    ];
    for (const [name, value] of files) {
      if (value === null) continue;
      await replaceConfig(name, JSON.stringify(value, null, 2) + "\n");
    }
    notify("Профиль применён");
    return true;
  }
}
