// Установленные расширения: темы VS Code и наборы сниппетов из Open VSX.
import { createSignal } from "solid-js";
import { core, type InstalledExt } from "../ipc";
import { notify, notifyError } from "../app/notify";
import { settings, updateSetting } from "../config/store";
import { monacoColors, paletteFromVsTheme, terminalColors, type Palette, type VsTheme } from "./vscodeTheme";

export interface ExtTheme {
  id: string;
  label: string;
  ext: string;
  palette: Palette;
  monaco: Record<string, string>;
  terminal: Record<string, string>;
}

export interface ExtSnippet {
  prefix: string | string[];
  body: string | string[];
  description?: string;
  language: string;
}

const [installed, setInstalled] = createSignal<InstalledExt[]>([]);
const [themes, setThemes] = createSignal<Map<string, ExtTheme>>(new Map());
const [snippets, setSnippets] = createSignal<ExtSnippet[]>([]);
export { installed as installedExtensions, themes as extThemes, snippets as extSnippets };

export const themeId = (ext: string, index: number) => `ext:${ext}/${index}`;

async function loadOne(e: InstalledExt, themeMap: Map<string, ExtTheme>, snips: ExtSnippet[]) {
  for (const [i, t] of e.themes.entries()) {
    try {
      const vs = JSON.parse(await core.extRead(e.id, t.file)) as VsTheme;
      const index = Number(/theme-(\d+)/.exec(t.file)?.[1] ?? i);
      const id = themeId(e.id, index);
      themeMap.set(id, {
        id,
        label: t.label,
        ext: e.id,
        palette: paletteFromVsTheme(vs, t.uiTheme),
        monaco: monacoColors(vs),
        terminal: terminalColors(vs),
      });
    } catch {
      /* битый файл темы — пропускаем */
    }
  }
  for (const s of e.snippets) {
    try {
      const body = JSON.parse(await core.extRead(e.id, s.file)) as Record<string, any>;
      for (const [name, v] of Object.entries(body)) {
        if (!v || !v.prefix || !v.body) continue;
        // language в package.json — один язык; scope внутри файла — список через запятую
        snips.push({ prefix: v.prefix, body: v.body, description: v.description ?? name, language: v.scope ?? s.language });
      }
    } catch {
      /* пропускаем */
    }
  }
}

async function reload() {
  const list = await core.extList().catch(() => [] as InstalledExt[]);
  const themeMap = new Map<string, ExtTheme>();
  const snips: ExtSnippet[] = [];
  for (const e of list) await loadOne(e, themeMap, snips);
  setInstalled(list);
  setThemes(themeMap);
  setSnippets(snips);
}

export async function initExtensions() {
  await reload();
}

const [busy, setBusy] = createSignal<string | null>(null);
export { busy as extBusy };

export async function installExtension(namespace: string, name: string) {
  const id = `${namespace}.${name}`;
  setBusy(id);
  try {
    const e = await core.extInstall(namespace, name);
    await reload();
    if (e.themes.length) {
      const first = themeId(e.id, Number(/theme-(\d+)/.exec(e.themes[0].file)?.[1] ?? 0));
      updateSetting("workbench.colorTheme", first as any);
      notify(
        `Установлено: ${e.displayName}. Тема «${e.themes[0].label}» включена` +
          (e.themes.length > 1 ? ` (ещё тем в расширении: ${e.themes.length - 1} — выберите в Настройки → Внешний вид)` : ""),
      );
    } else {
      notify(`Установлено: ${e.displayName}. Сниппеты: ${e.snippets.map((s) => s.language).join(", ")}`);
    }
  } catch (err) {
    notifyError(`Не удалось установить ${id}`, err);
  } finally {
    setBusy(null);
  }
}

export async function uninstallExtension(id: string) {
  setBusy(id);
  try {
    const current = String(settings()["workbench.colorTheme"]);
    await core.extUninstall(id);
    if (current.startsWith(`ext:${id}/`)) updateSetting("workbench.colorTheme", "steppe" as any);
    await reload();
  } catch (err) {
    notifyError("Не удалось удалить расширение", err);
  } finally {
    setBusy(null);
  }
}
