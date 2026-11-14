// Галерея тем: все темы карточками с живым предпросмотром, своя тема из
// палитры цветов и «Поделиться» — файлом или кодом, который друг вставит.
import { createMemo, createSignal, For, Show } from "solid-js";
import { allThemes, paletteOf } from "./themes";
import { settings, updateSetting } from "../config/store";
import { notify, notifyError } from "./notify";
import { core } from "../ipc";
import { open, saveAs } from "../i18n/dialog";
import { askInput } from "./InputBox";
import { executeCommand } from "../commands/registry";
import type { Palette } from "../extensions/vscodeTheme";

const [visible, setVisible] = createSignal(false);
export const showThemeGallery = () => setVisible(true);

const CODE_PREFIX = "TULPAR-THEME:";
const EDITABLE: [keyof Palette, string][] = [
  ["bg", "Фон окна"],
  ["island", "Панели"],
  ["code", "Фон кода"],
  ["text", "Текст"],
  ["muted", "Приглушённый текст"],
  ["accent", "Акцент"],
  ["kw", "Ключевые слова"],
  ["fn", "Функции"],
  ["str", "Строки"],
  ["num", "Числа"],
  ["com", "Комментарии"],
  ["type", "Типы"],
];

const hexOk = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Мини-окно редактора в цветах палитры. */
function Preview(props: { p: Palette }) {
  const p = () => props.p;
  return (
    <div class="tg-preview" style={{ background: p().bg }}>
      <div class="tg-side" style={{ background: p().island }}>
        <i style={{ background: p().accent }} />
        <i style={{ background: p().muted }} />
        <i style={{ background: p().muted }} />
      </div>
      <div class="tg-code" style={{ background: p().code, color: p().text }}>
        <div>
          <b style={{ color: p().kw }}>def</b> <span style={{ color: p().fn }}>greet</span>(<span style={{ color: p().param }}>name</span>):
        </div>
        <div>
          &nbsp;&nbsp;<span style={{ color: p().com }}># привет</span>
        </div>
        <div>
          &nbsp;&nbsp;<b style={{ color: p().kw }}>return</b> <span style={{ color: p().str }}>"Hi "</span> + <span style={{ color: p().type }}>str</span>(<span style={{ color: p().num }}>42</span>)
        </div>
      </div>
    </div>
  );
}

function slug(name: string) {
  return (name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "") || "theme") + "-" + Math.random().toString(36).slice(2, 6);
}

function saveCustom(name: string, palette: Palette, id?: string): string {
  const key = id ?? slug(name);
  const all = { ...(settings()["tulpar.customThemes"] ?? {}) };
  all[key] = { name, palette: palette as unknown as Record<string, string | boolean> };
  updateSetting("tulpar.customThemes", all);
  return `custom:${key}`;
}

function encode(name: string, p: Palette): string {
  const json = JSON.stringify({ name, palette: p });
  return CODE_PREFIX + btoa(unescape(encodeURIComponent(json)));
}

function decode(text: string): { name: string; palette: Palette } | null {
  try {
    const t = text.trim();
    const json = t.startsWith(CODE_PREFIX) ? decodeURIComponent(escape(atob(t.slice(CODE_PREFIX.length)))) : t;
    const data = JSON.parse(json);
    if (!data || typeof data.name !== "string" || typeof data.palette !== "object") return null;
    const p = data.palette as Record<string, unknown>;
    // Принимаем только цвета — никакого кода из чужих файлов
    const clean: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(p)) if (hexOk(v) || (k === "light" && typeof v === "boolean")) clean[k] = v as string | boolean;
    if (!hexOk(clean.bg) || !hexOk(clean.code) || !hexOk(clean.text)) return null;
    return { name: data.name.slice(0, 60), palette: { ...paletteOf("steppe"), ...clean } as Palette };
  } catch {
    return null;
  }
}

async function shareTheme(id: string, name: string) {
  const p = paletteOf(id);
  const code = encode(name, p);
  await navigator.clipboard.writeText(code).catch(() => undefined);
  notify(`Код темы «${name}» скопирован — отправьте его другу. Он вставит его в «Галерея тем → Импорт».`, "info", [
    {
      label: "Сохранить файлом…",
      run: async () => {
        try {
          const path = await saveAs({ title: "Сохранить тему", defaultPath: `${name.replace(/[\\/:*?"<>|]/g, "")}.tulpar-theme`, filters: [{ name: "Тема Tulpar", extensions: ["tulpar-theme"] }] });
          if (path) await core.userFileWrite(path, JSON.stringify({ name, palette: p }, null, 2));
        } catch (e) {
          notifyError("Не удалось сохранить тему", e);
        }
      },
    },
  ]);
}

async function importTheme() {
  const code = await askInput({ title: "Импорт темы", placeholder: "Вставьте код TULPAR-THEME:… или оставьте пустым, чтобы выбрать файл" });
  if (code === null) return;
  let data = code.trim() ? decode(code) : null;
  if (!code.trim()) {
    const picked = await open({ title: "Файл темы", filters: [{ name: "Тема Tulpar", extensions: ["tulpar-theme", "json"] }] });
    if (typeof picked !== "string") return;
    data = decode(await core.userFileRead(picked).catch(() => ""));
  }
  if (!data) {
    notify("Это не тема Tulpar", "error");
    return;
  }
  const id = saveCustom(data.name, data.palette);
  updateSetting("workbench.colorTheme", id);
  notify(`Тема «${data.name}» добавлена и включена`);
}

function ThemeEditor(props: { base: string; editId?: string; onDone: () => void }) {
  const initial = paletteOf(props.base);
  const existing = props.editId ? (settings()["tulpar.customThemes"] ?? {})[props.editId] : undefined;
  const [name, setName] = createSignal(existing?.name ?? "Моя тема");
  const [p, setP] = createSignal<Palette>({ ...initial });
  const set = (k: keyof Palette, v: string) => setP((x) => ({ ...x, [k]: v }));

  const save = () => {
    const id = saveCustom(name().trim() || "Моя тема", p(), props.editId);
    updateSetting("workbench.colorTheme", id);
    notify(`Тема «${name()}» сохранена и включена`);
    props.onDone();
  };

  return (
    <div class="tg-editor">
      <div class="tg-editor-left">
        <label class="tg-field">
          <span>Название</span>
          <input class="tg-name" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <div class="tg-colors">
          <For each={EDITABLE}>
            {([key, label]) => (
              <label class="tg-color">
                <input type="color" value={String(p()[key])} onInput={(e) => set(key, e.currentTarget.value)} />
                <span>{label}</span>
              </label>
            )}
          </For>
        </div>
        <label class="tg-color">
          <input type="checkbox" checked={p().light} onChange={(e) => setP((x) => ({ ...x, light: e.currentTarget.checked, strong: e.currentTarget.checked ? "#000000" : "#ffffff" }))} />
          <span>Светлая тема</span>
        </label>
      </div>
      <div class="tg-editor-right">
        <Preview p={p()} />
        <div class="tg-editor-buttons">
          <button class="button" onClick={save}>
            Сохранить и включить
          </button>
          <button class="button-quiet" onClick={props.onDone}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ThemeGallery() {
  const [editing, setEditing] = createSignal<{ base: string; editId?: string } | null>(null);
  const current = () => String(settings()["workbench.colorTheme"]);
  const themes = createMemo(() => allThemes().filter(([id]) => id !== "photo" || settings()["tulpar.photoTheme"]));

  const removeCustom = (id: string) => {
    const key = id.slice("custom:".length);
    const all = { ...(settings()["tulpar.customThemes"] ?? {}) };
    delete all[key];
    updateSetting("tulpar.customThemes", all);
    if (current() === id) updateSetting("workbench.colorTheme", "steppe");
  };

  return (
    <Show when={visible()}>
      <div class="tg-overlay" onClick={(e) => e.target === e.currentTarget && setVisible(false)} onKeyDown={(e) => e.key === "Escape" && setVisible(false)}>
        <div class="tg-dialog" role="dialog" aria-label="Галерея тем">
          <div class="tg-head">
            <h2>{editing() ? "Своя тема" : "Галерея тем"}</h2>
            <Show when={!editing()}>
              <button class="button" onClick={() => setEditing({ base: current() })}>
                ✦ Создать свою
              </button>
              <button class="button-quiet" onClick={() => void importTheme()}>
                Импорт…
              </button>
              <button
                class="button-quiet"
                onClick={() => {
                  setVisible(false);
                  void executeCommand("workbench.view.extensions");
                }}
              >
                Темы VS Code…
              </button>
            </Show>
            <button class="icon-button tg-close" title="Закрыть" aria-label="Закрыть" onClick={() => setVisible(false)}>
              ✕
            </button>
          </div>

          <Show
            when={editing()}
            fallback={
              <div class="tg-grid">
                <For each={themes()}>
                  {([id, label]) => (
                    <div class="tg-card" classList={{ on: current() === id }}>
                      <button class="tg-card-main" onClick={() => updateSetting("workbench.colorTheme", id)} title="Включить">
                        <Preview p={paletteOf(id)} />
                        <span class="tg-card-name" data-no-translate={id.startsWith("ext:") || id.startsWith("custom:") ? "" : undefined}>
                          {label}
                        </span>
                      </button>
                      <div class="tg-card-actions">
                        <button class="icon-button" title="Поделиться" aria-label="Поделиться" onClick={() => void shareTheme(id, label.replace(/ ✦$| · .*$/, ""))}>
                          ⤴
                        </button>
                        <button
                          class="icon-button"
                          title="Сделать свою на основе этой"
                          aria-label="Сделать свою на основе этой"
                          onClick={() => setEditing({ base: id, editId: id.startsWith("custom:") ? id.slice(7) : undefined })}
                        >
                          ✎
                        </button>
                        <Show when={id.startsWith("custom:")}>
                          <button class="icon-button" title="Удалить" aria-label="Удалить" onClick={() => removeCustom(id)}>
                            ✕
                          </button>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            {(e) => <ThemeEditor base={e().base} editId={e().editId} onDone={() => setEditing(null)} />}
          </Show>
        </div>
      </div>
    </Show>
  );
}
