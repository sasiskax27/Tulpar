// Окно настроек (Ctrl+,). Каждое изменение применяется сразу и записывается
// в settings.json — тот же файл можно править и руками.
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ask } from "../i18n/dialog";
import {
  defaultSettings,
  settings,
  updateUserKeybindings,
  updateSetting,
  userKeybindings,
  type Settings,
} from "../config/store";
import { settingsVisible, setSettingsVisible, settingsSection, setSettingsSection } from "../app/ui";
import { allCommands, executeCommand, label } from "../commands/registry";
import { chooseBackground, clearBackground, usePhotoTheme } from "../app/background";
import { providers } from "../ai/ai";
import { focusEditor } from "../editor/instance";
import { baseName, core } from "../ipc";
import { pick } from "../app/QuickPick";
import { notify, notifyError } from "../app/notify";
import LocalAi from "./LocalAi";
import Toolchains from "./Toolchains";
import { copilotSignIn, copilotSignOut, copilotState, copilotUser } from "../ai/copilot";
import AiServices from "./AiServices";
import { switchService } from "../ai/services";
import { claudeModels, cloudCatalog, openaiModels, opencodeModels } from "../ai/models";
import { installed, isInstalled } from "../ai/ollama";
import { allThemes } from "../app/themes";
import CustomActions from "./CustomActions";
import { exportProfile, importProfile } from "./profile";
import { uploadSettings, downloadSettings } from "./sync";
import { formatStrokes, keybindingList, normalizeStroke, strokeFromEvent } from "../keybindings/keybindings";

type Text = string | (() => string);

type FieldDef = { key: keyof Settings & string; label: string; hint?: Text } & (
  | { type: "number"; min: number; max: number }
  | { type: "range"; min: number; max: number; step: number; show: (v: number) => string }
  | { type: "text"; placeholder?: Text }
  | { type: "password"; placeholder?: Text }
  | { type: "select"; options: [value: string, label: string][] | (() => [value: string, label: string][]) }
  | { type: "toggle" }
);

/** Группы разделов: так настройки разложены по смыслу — от ИИ до системы. */
type GroupId = "general" | "code" | "look" | "ai" | "fun" | "system";

interface Section {
  id: string;
  group: GroupId;
  title: string;
  intro?: Text;
  fields: FieldDef[];
  extra?: (query?: string) => JSX.Element;
  /** Показать extra после полей, а не перед ними */
  after?: boolean;
  /** Раздел ищется и внутри extra (например, список сочетаний клавиш) */
  searchInExtra?: boolean;
}

/** Строка «GitHub Copilot»: статус и вход. */
function CopilotRow() {
  const label = () =>
    ({
      off: "Не запущен",
      starting: "Запускается…",
      signedOut: "Не выполнен вход",
      ready: `Работает${copilotUser() ? ` · ${copilotUser()}` : ""}`,
      error: "Ошибка запуска",
      missing: "Не установлен",
    })[copilotState()];
  return (
    <div class="settings-row">
      <div class="settings-label">
        <span>GitHub Copilot</span>
        <small>
          {label()}. Подсказки Copilot при наборе — включите «Подсказки при наборе» и выберите «GitHub Copilot». Бесплатный тариф —
          github.com/settings/copilot.
        </small>
      </div>
      <div class="settings-control settings-buttons">
        <Show
          when={copilotState() === "ready"}
          fallback={
            <button
              class="button"
              onClick={() => {
                updateSetting("tulpar.ai.inline", true);
                updateSetting("tulpar.ai.inlineProvider", "copilot");
                void copilotSignIn();
              }}
            >
              Войти в Copilot
            </button>
          }
        >
          <button class="button-quiet" onClick={() => void copilotSignOut()}>
            Выйти
          </button>
        </Show>
      </div>
    </div>
  );
}

type ModelChoice = { label: string; detail?: string; value: string };

/** Модели с сервера (OpenAI-совместимый /models); null — не получилось. */
async function serverModels(name: string): Promise<{ id: string; free: boolean }[] | null> {
  const cfg = settings();
  const base = String(cfg["tulpar.ai.baseUrl"] ?? "").trim() || providers[name]?.baseUrl || "";
  try {
    return await core.aiModels(name, base, String(cfg["tulpar.ai.apiKey"] ?? ""));
  } catch {
    return null;
  }
}

/** Список моделей для выбранного варианта ИИ. */
async function modelChoices(name: string): Promise<{ items: ModelChoice[]; title: string } | null> {
  switch (name) {
    case "ollama": {
      const local = installed()
        .filter((m) => !m.name.includes("cloud"))
        .map((m) => ({ label: m.name, detail: "на компьютере · бесплатно", value: m.name }));
      const cloud = cloudCatalog.map((m) => ({
        label: m.tag,
        detail: `облако · ${m.free ? "бесплатно с лимитом" : "нужна подписка Ollama"} · ${isInstalled(m.tag) ? "готова" : "нажмите «Установить» в «Локальный ИИ» и войдите"}`,
        value: m.tag,
      }));
      return { items: [...local, ...cloud], title: "Модель Ollama: на компьютере или в облаке (бесплатно)" };
    }
    case "opencode":
      return {
        items: opencodeModels.map((m) => ({ label: m.id, detail: `платно · ${m.note}`, value: m.id })),
        title: "Модель OpenCode Zen (платно; бесплатные работают только в программе OpenCode)",
      };
    case "anthropic":
      return { items: claudeModels.map((m) => ({ label: m.id, detail: `платно · ${m.note}`, value: m.id })), title: "Модель Claude (платно)" };
    case "openai": {
      const list = await serverModels(name);
      const items = list?.length
        ? list.map((m) => ({ label: m.id, detail: m.free ? "бесплатно" : "платно", value: m.id }))
        : openaiModels.map((m) => ({ label: m.id, detail: `платно · ${m.note}`, value: m.id }));
      return { items, title: list?.length ? "Модели сервера" : "Модель OpenAI (платно; полный список появится, когда укажете ключ)" };
    }
    case "openrouter": {
      const list = await serverModels(name);
      if (!list?.length) {
        notifyError("Не удалось загрузить модели OpenRouter", "проверьте интернет");
        return null;
      }
      return {
        items: list.map((m) => ({ label: m.id, detail: m.free ? "бесплатно (лимит 50 запросов в день)" : "платно", value: m.id })),
        title: "Модель OpenRouter — бесплатные сверху",
      };
    }
    case "github":
      return {
        items: ["openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o", "openai/o4-mini", "deepseek/DeepSeek-R1", "meta/Llama-4-Scout-17B-16E-Instruct", "microsoft/Phi-4", "mistral-ai/Codestral-2501"].map((id) => ({ label: id, detail: "бесплатно с лимитом", value: id })),
        title: "Модель GitHub Models (полный список — github.com/marketplace/models)",
      };
    default: {
      const list = await serverModels(name);
      if (!list?.length) {
        notifyError("Не удалось загрузить список моделей", "проверьте ключ API и интернет, или впишите название модели вручную");
        return null;
      }
      const clean = (id: string) => id.replace(/^models\//, "");
      return { items: list.map((m) => ({ label: clean(m.id), detail: m.free ? "бесплатно" : undefined, value: clean(m.id) })), title: "Модели сервиса" };
    }
  }
}

async function chooseModel() {
  const name = String(settings()["tulpar.ai.provider"]);
  const choices = await modelChoices(name);
  if (!choices) return;
  if (!choices.items.length) {
    notify("Список пуст. Для Ollama установите модель в разделе «Локальный ИИ».");
    return;
  }
  const chosen = await pick(choices.items, choices.title);
  if (chosen) updateSetting("tulpar.ai.model", chosen);
}

const resolve = (t: Text | undefined) => (typeof t === "function" ? t() : t);
const provider = () => providers[String(settings()["tulpar.ai.provider"])];

async function resetSettings() {
  const ok = await ask("Вернуть все настройки к стандартным? Ключи API и выбранная модель тоже сбросятся.", { title: "Сброс настроек", kind: "warning" });
  if (!ok) return;
  try {
    const path = await core.configEnsure("settings.json");
    await core.writeFile(path, "{\n}\n");
    notify("Настройки сброшены");
  } catch (e) {
    notifyError("Не удалось сбросить настройки", e);
  }
}

const fileButton = (label: string, command: string) => (
  <button
    class="button-quiet"
    onClick={() => {
      setSettingsVisible(false);
      void executeCommand(command);
    }}
  >
    {label}
  </button>
);

/** Иконка раздела: один стиль на всё окно настроек. */
const glyph = (children: JSX.Element, size = 16) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {children}
  </svg>
);

const groups: { id: GroupId; title: string; icon: (size?: number) => JSX.Element }[] = [
  {
    id: "general",
    title: "Общие",
    icon: (s) => glyph(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>, s),
  },
  {
    id: "code",
    title: "Редактор",
    icon: (s) => glyph(<><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" /></>, s),
  },
  {
    id: "look",
    title: "Оформление",
    icon: (s) => glyph(<><path d="M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.6a2.4 2.4 0 0 0-1.7 4.1A2 2 0 0 1 12 21z" /><circle cx="8.2" cy="10.2" r="1.1" /><circle cx="12" cy="7.6" r="1.1" /><circle cx="15.8" cy="10.2" r="1.1" /></>, s),
  },
  {
    id: "ai",
    title: "ИИ",
    icon: (s) => glyph(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>, s),
  },
  {
    id: "fun",
    title: "Фишки",
    icon: (s) => glyph(<><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></>, s),
  },
  {
    id: "system",
    title: "Система",
    icon: (s) => glyph(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>, s),
  },
];


/** Значения считаем одинаковыми, если совпадают как примитивы или как JSON. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Список горячих клавиш: команда и её сочетание. Клик по сочетанию — задать новое. */
function Keybindings(props: { query: string }) {
  const [listening, setListening] = createSignal<string | null>(null);
  const titles = () => new Map(allCommands().map((c) => [c.id, label(c)]));
  /** Нормализованные сочетания, назначенные пользователем, — они помечаются как «своя». */
  const custom = () =>
    new Set(
      userKeybindings()
        .filter((b) => !b.command.startsWith("-"))
        .map((b) => b.key.split(" ").filter(Boolean).map(normalizeStroke).join(" ")),
    );

  const rows = () => {
    const q = props.query.trim().toLowerCase();
    return keybindingList()
      .map((b) => ({ command: b.command, keys: formatStrokes(b.strokes), custom: custom().has(b.strokes.join(" ")) }))
      .map((r) => ({ ...r, title: titles().get(r.command) ?? r.command }))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q) || r.command.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  };

  /** Назначить команде новое сочетание (или null — вернуть стандартное). */
  const assign = async (command: string, strokes: string[] | null) => {
    const name = titles().get(command) ?? command;
    const old = keybindingList().filter((b) => b.command === command);
    // Пользовательские записи для команды пересобираем целиком.
    let next = userKeybindings().filter((b) => b.command !== command && b.command !== "-" + command);
    if (strokes && strokes.length) {
      const key = strokes.join(" ");
      const taken = keybindingList().find((b) => b.command !== command && b.strokes.join(" ") === key);
      if (taken) {
        notify(`Сочетание ${formatStrokes(strokes)} было у «${titles().get(taken.command) ?? taken.command}» — теперь оно у «${name}»`);
      }
      next = next.filter((b) => b.key.split(" ").filter(Boolean).map(normalizeStroke).join(" ") !== key);
      next.push({ key, command });
      // Стандартное сочетание на старых клавишах гасим отрицательной записью.
      for (const o of old) {
        const oldKey = o.strokes.join(" ");
        if (oldKey && oldKey !== key) next.push({ key: oldKey, command: "-" + command });
      }
      await updateUserKeybindings(next);
      notify(`«${name}»: ${formatStrokes(strokes)}`);
    } else {
      await updateUserKeybindings(next);
      notify(`«${name}»: сочетание возвращено к стандартному`);
    }
  };

  // Пока команда ждёт новое сочетание, перехватываем клавиатуру окна.
  createEffect(() => {
    const command = listening();
    if (!command) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(null);
        return;
      }
      const stroke = strokeFromEvent(e);
      if (!stroke) return;
      setListening(null);
      void assign(command, [stroke]);
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  return (
    <div class="settings-keys">
      <For each={rows()}>
        {(r) => (
          <div class="settings-key-row" classList={{ listening: listening() === r.command }}>
            <span class="settings-key-title" title={r.command}>
              {r.title}
              <Show when={r.custom}>
                <em class="settings-key-tag">своя</em>
              </Show>
            </span>
            <span class="settings-key-side">
              <Show
                when={listening() === r.command}
                fallback={
                  <button
                    class="settings-kbd-btn"
                    title="Нажмите, чтобы задать новое сочетание"
                    onClick={() => setListening(r.command)}
                  >
                    <kbd>{r.keys || "не задано"}</kbd>
                  </button>
                }
              >
                <span class="settings-kbd-wait">
                  Нажмите сочетание…
                  <em>Esc — отмена</em>
                </span>
              </Show>
              <Show when={r.custom}>
                <button class="settings-kbd-reset" title="Вернуть стандартное сочетание" onClick={() => void assign(r.command, null)}>
                  ×
                </button>
              </Show>
            </span>
          </div>
        )}
      </For>
      <p class="settings-keys-hint">
        Свои сочетания хранятся в keybindings.json. Аккорды из двух нажатий подряд и отключение стандартных («-команда») удобнее править в файле.
      </p>
    </div>
  );
}

const sectionList: Section[] = [
  {
    id: "editor",
    group: "code",
    title: "Редактор",
    fields: [
      { key: "editor.fontSize", label: "Размер шрифта", type: "number", min: 8, max: 40 },
      {
        key: "editor.fontFamily",
        label: "Шрифт",
        hint: "Название шрифта, установленного в системе. Можно несколько через запятую.",
        type: "text",
        placeholder: "'JetBrains Mono', Consolas, monospace",
      },
      {
        key: "editor.lineHeight",
        label: "Высота строки",
        hint: "0 — подобрать автоматически по размеру шрифта.",
        type: "number",
        min: 0,
        max: 60,
      },
      { key: "editor.tabSize", label: "Ширина отступа", type: "number", min: 1, max: 8 },
      { key: "editor.insertSpaces", label: "Отступы пробелами", hint: "Выключено — табуляцией.", type: "toggle" },
      {
        key: "editor.wordWrap",
        label: "Перенос длинных строк",
        type: "select",
        options: [["off", "Не переносить"], ["on", "Переносить"]],
      },
      {
        key: "editor.lineNumbers",
        label: "Номера строк",
        type: "select",
        options: [["on", "Показывать"], ["relative", "Относительные"], ["off", "Скрыть"]],
      },
      { key: "editor.minimap.enabled", label: "Мини-карта", type: "toggle" },
      {
        key: "editor.cursorStyle",
        label: "Вид курсора",
        type: "select",
        options: [["line", "Полоска"], ["line-thin", "Тонкая полоска"], ["block", "Блок"], ["underline", "Подчёркивание"]],
      },
      { key: "editor.fontLigatures", label: "Лигатуры шрифта", hint: "=> != === рисуются одним знаком, если шрифт это умеет (JetBrains Mono, Fira Code).", type: "toggle" },
      { key: "editor.bracketPairColorization.enabled", label: "Цветные скобки", hint: "Парные скобки разными цветами.", type: "toggle" },
      { key: "editor.stickyScroll.enabled", label: "Липкие заголовки", hint: "Строка с началом функции или класса остаётся наверху при прокрутке.", type: "toggle" },
      { key: "editor.guides.indentation", label: "Линии отступов", type: "toggle" },
      { key: "git.blame.inline", label: "Кто менял строку", hint: "Автор, время и сообщение коммита — бледным текстом в конце строки с курсором.", type: "toggle" },
      { key: "breadcrumbs.enabled", label: "Хлебные крошки", hint: "Над кодом: путь файла и функция, в которой стоит курсор.", type: "toggle" },
      { key: "editor.folding", label: "Сворачивание блоков", hint: "Стрелки слева от кода, чтобы скрыть функцию или цикл.", type: "toggle" },
      {
        key: "editor.renderWhitespace",
        label: "Показывать пробелы",
        type: "select",
        options: [["none", "Нет"], ["selection", "В выделении"], ["boundary", "По краям слов"], ["all", "Все"]],
      },
      {
        key: "editor.renderLineHighlight",
        label: "Подсветка строки с курсором",
        type: "select",
        options: [["line", "Вся строка"], ["gutter", "Только номера строк"], ["all", "Строка и номера"], ["none", "Не подсвечивать"]],
      },
      {
        key: "editor.occurrencesHighlight",
        label: "Подсвечивать другие вхождения",
        hint: "Все копии слова под курсором в открытом файле.",
        type: "toggle",
      },
      {
        key: "editor.cursorSurroundingLines",
        label: "Строк видно над и под курсором",
        hint: "0 — обычная прокрутка. 3–5 удобно, чтобы курсор не прилипал к краю окна.",
        type: "range",
        min: 0,
        max: 10,
        step: 1,
        show: (v) => (v ? `${v}` : "нет"),
      },
      { key: "editor.rulers", label: "Линии-ограничители", hint: "Номера столбцов через запятую, например 80, 120. Пусто — без линий.", type: "text", placeholder: "80, 120" },
      {
        key: "editor.autoClosingBrackets",
        label: "Закрывать скобки сами",
        type: "select",
        options: [["languageDefined", "По правилам языка"], ["always", "Всегда"], ["never", "Никогда"]],
      },
      { key: "editor.smoothScrolling", label: "Плавная прокрутка и курсор", type: "toggle" },
      { key: "editor.mouseWheelZoom", label: "Ctrl + колесо мыши — размер шрифта", type: "toggle" },
      { key: "editor.formatOnSave", label: "Форматировать при сохранении", hint: "Через языковой сервер (например, ruff, prettier, rustfmt), если он умеет форматировать.", type: "toggle" },
      { key: "files.trimTrailingWhitespace", label: "Убирать пробелы в конце строк при сохранении", type: "toggle" },
      { key: "files.insertFinalNewline", label: "Пустая строка в конце файла при сохранении", type: "toggle" },
      {
        key: "editor.cursorBlinking",
        label: "Курсор",
        type: "select",
        options: [["smooth", "Плавное мигание"], ["blink", "Мигание"], ["phase", "Затухание"], ["expand", "Расширение"], ["solid", "Не мигает"]],
      },
      {
        key: "files.autoSave",
        label: "Автосохранение",
        type: "select",
        options: [["off", "Выключено"], ["afterDelay", "Через секунду после правки"]],
      },
      {
        key: "tulpar.update.check",
        label: "Проверять обновления",
        hint: "Раз в 12 часов Tulpar спрашивает у GitHub, вышла ли новая версия. Никаких данных о вас не отправляется. Проверить вручную — команда «Проверить обновления».",
        type: "toggle",
      },
    ],
  },
  {
    id: "appearance",
    group: "look",
    title: "Внешний вид",
    fields: [
      {
        key: "workbench.language",
        label: "Язык интерфейса · Language",
        hint: "Окно перезагрузится, открытые файлы останутся.",
        type: "select",
        options: [["auto", "Как в системе"], ["ru", "Русский"], ["en", "English"], ["kk", "Қазақша"]],
      },
      {
        key: "workbench.style",
        label: "Стиль интерфейса",
        hint: "Дизайн 2 — верхняя панель с ИИ-островом, боковая панель выезжает при наведении на левый край.",
        type: "select",
        options: [["classic", "Дизайн 1 — полоса иконок"], ["tulpar", "Дизайн 2 — Tulpar"]],
      },
      { key: "workbench.colorTheme", label: "Тема", type: "select", options: allThemes },
      { key: "workbench.islands", label: "Панели-острова", hint: "Скруглённые панели с промежутками. В Дизайне 2 включены всегда.", type: "toggle" },
      {
        key: "workbench.activityBar",
        label: "Полоса иконок",
        hint: "Дизайн 1. Если скрыть — разделы переключаются сверху боковой панели.",
        type: "select",
        options: [["left", "Слева"], ["right", "Справа"], ["hidden", "Скрыть"]],
      },
      {
        key: "workbench.tabs.style",
        label: "Вкладки",
        type: "select",
        options: [["pills", "Капсулы"], ["underline", "С подчёркиванием"], ["classic", "Классические"]],
      },
      { key: "workbench.radius", label: "Скругление углов", type: "range", min: 0, max: 20, step: 1, show: (v) => (v ? `${v} px` : "прямые") },
      { key: "workbench.gap", label: "Промежуток между панелями", type: "range", min: 0, max: 16, step: 1, show: (v) => `${v} px` },
      { key: "workbench.uiFontSize", label: "Шрифт интерфейса", type: "range", min: 11, max: 16, step: 1, show: (v) => `${v} px` },
      { key: "workbench.statusBar.visible", label: "Строка статуса внизу", type: "toggle" },
      { key: "workbench.sidebar.autoHide", label: "Прятать боковую панель", hint: "Дизайн 2: панель выезжает при наведении на левый край и прячется, когда уводишь мышь.", type: "toggle" },
      {
        key: "tulpar.background.mode",
        label: "Как показывать фон",
        hint: "«За панелями» — фон под окном, а панели как матовое стекло. «Поверх» — лёгкая дымка поверх всего окна.",
        type: "select",
        options: [["behind", "За панелями (стекло)"], ["overlay", "Поверх окна"]],
      },
      {
        key: "workbench.panelOpacity",
        label: "Непрозрачность панелей",
        hint: "Для режима «за панелями»: меньше — сильнее просвечивает фон.",
        type: "range",
        min: 0.3,
        max: 1,
        step: 0.01,
        show: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "workbench.panelBlur",
        label: "Размытие под панелями",
        type: "range",
        min: 0,
        max: 40,
        step: 1,
        show: (v) => (v ? `${v} px` : "нет"),
      },
      {
        key: "tulpar.background.opacity",
        label: "Яркость фона",
        type: "range",
        min: 0.02,
        max: 0.6,
        step: 0.01,
        show: (v) => `${Math.round(v * 100)}%`,
      },
      {
        key: "tulpar.background.blur",
        label: "Размытие фона",
        type: "range",
        min: 0,
        max: 30,
        step: 1,
        show: (v) => (v ? `${v} px` : "нет"),
      },
      {
        key: "tulpar.background.fit",
        label: "Размер фона",
        type: "select",
        options: [["cover", "Заполнить окно"], ["contain", "Вписать целиком"], ["center", "Как есть, по центру"], ["tile", "Замостить"]],
      },
    ],
    extra: () => {
      const image = () => settings()["tulpar.background.image"];
      return (
        <div class="settings-row">
          <div class="settings-label">
            <span>Фон: картинка или видео</span>
            <small>{image() ? baseName(image()!) : "Картинка или видео (MP4, WebM до 80 МБ). Можно просто перетащить файл в окно Tulpar."}</small>
          </div>
          <div class="settings-control settings-buttons">
            <button class="button" onClick={() => void chooseBackground()}>
              Выбрать…
            </button>
            <Show when={image() && settings()["workbench.colorTheme"] !== "photo"}>
              <button class="button-quiet" title="Подобрать цвета интерфейса и кода под картинку" onClick={usePhotoTheme}>
                Тема по картинке
              </button>
            </Show>
            <Show when={image()}>
              <button class="button-quiet" onClick={clearBackground}>
                Убрать
              </button>
            </Show>
          </div>
        </div>
      );
    },
  },
  {
    id: "terminal",
    group: "code",
    title: "Терминал",
    fields: [
      {
        key: "terminal.integrated.shell",
        label: "Оболочка",
        hint: "Пусто — PowerShell на Windows, ваша оболочка на macOS и Linux. Действует для новых терминалов.",
        type: "text",
        placeholder: "cmd.exe, pwsh.exe, wsl.exe…",
      },
      { key: "terminal.integrated.fontSize", label: "Размер шрифта", type: "number", min: 8, max: 40 },
      { key: "terminal.integrated.fontFamily", label: "Шрифт терминала", hint: "Пусто — тот же, что в редакторе.", type: "text", placeholder: "Cascadia Mono, Consolas" },
      {
        key: "terminal.integrated.cursorStyle",
        label: "Курсор терминала",
        type: "select",
        options: [["block", "Блок"], ["bar", "Полоска"], ["underline", "Подчёркивание"]],
      },
      { key: "terminal.integrated.scrollback", label: "Строк в истории терминала", type: "number", min: 500, max: 100000 },
    ],
  },
  {
    id: "tools",
    group: "system",
    title: "SDK и инструменты",
    intro: "Языки и сборщики для запуска проектов: если чего-то нет — установка одной кнопкой (во вкладке терминала).",
    fields: [],
    extra: () => <Toolchains />,
  },
  {
    id: "ai",
    group: "ai",
    title: "ИИ",
    intro:
      "Выделите код, нажмите правую кнопку мыши и выберите действие «ИИ: …». Код отправляется только на сервер, указанный здесь, и только по вашей команде.",
    extra: () => (
      <>
      <AiServices />
      <CopilotRow />
      <Show when={String(settings()["tulpar.ai.provider"]) !== "none"}>
        <div class="settings-row">
          <div class="settings-label">
            <span>Модель из списка</span>
            <small>
              {settings()["tulpar.ai.model"] ? `Сейчас: ${settings()["tulpar.ai.model"]}` : "Выбрать модель из списка."}
            </small>
          </div>
          <div class="settings-control settings-buttons">
            <button class="button" onClick={() => void chooseModel()}>
              Выбрать модель…
            </button>
          </div>
        </div>
      </Show>
      </>
    ),
    fields: [
      {
        key: "tulpar.chat.location",
        label: "Где чат с ИИ",
        hint: "Внизу — вкладкой рядом с терминалом: можно перетаскивать в чат файлы из проводника.",
        type: "select",
        options: [["bottom", "Внизу, рядом с терминалом"], ["sidebar", "В боковой панели"]],
      },
      {
        key: "tulpar.agent.approve",
        label: "Агент: спрашивать разрешение",
        hint: "Агент в чате сам читает файлы, правит код и запускает команды. Любую правку потом можно отменить кнопкой под шагом.",
        type: "select",
        options: [["ask", "На правки и команды"], ["edits", "Только на команды"], ["all", "Не спрашивать (осторожно)"]],
      },
      { key: "tulpar.agent.maxSteps", label: "Агент: шагов на задачу", type: "number", min: 3, max: 200 },
      {
        key: "tulpar.ai.think",
        label: "Модель думает перед ответом",
        hint: "Qwen 3, DeepSeek R1 и похожие модели сначала долго «думают про себя». Выключено — отвечают в разы быстрее, почти без потери качества в обычных вопросах.",
        type: "toggle",
      },
      {
        key: "tulpar.ai.contextSize",
        label: "Память модели (Ollama)",
        hint: "Сколько токенов разговора модель держит в голове. Мало — агент забывает инструкции и файлы. 16384 подходит для 7B при 16 ГБ памяти; если компьютер тормозит — 8192.",
        type: "select",
        options: [["4096", "4 096 — очень мало"], ["8192", "8 192"], ["16384", "16 384 (рекомендуется)"], ["32768", "32 768 — нужно много памяти"]],
      },
      {
        key: "tulpar.ai.provider",
        label: "Какой ИИ использовать",
        hint: () =>
          ({
            none: "ИИ выключен.",
            ollama:
              "Бесплатно. Модель работает на вашем компьютере, а для слабых компьютеров есть облачные модели (:cloud) — см. «Локальный ИИ» ниже. Нужна установленная Ollama.",
            openai: "Любой сервис с OpenAI-совместимым API: OpenAI, LM Studio и другие. Платно, нужен ключ.",
            openrouter:
              "Сотни моделей через один ключ (openrouter.ai/keys, бесплатно, без карты). Модели с пометкой «бесплатно» — без оплаты, но всего 50 запросов в день; агенту этого хватит на пару задач.",
            opencode:
              "Облачные модели OpenCode Zen — работают на их серверах, компьютер не нагружается. Платно, оплата за запросы: ключ и баланс — на opencode.ai/console. Бесплатные модели OpenCode работают только в самой программе OpenCode — откройте её кнопкой «OpenCode» в чате, она запустится во вкладке терминала в папке проекта.",
            anthropic: "Claude через API. Нужен ключ API из консоли Anthropic.",
          })[String(settings()["tulpar.ai.provider"])] ?? "Подробности — в карточке сервиса выше.",
        type: "select",
        options: [
          ["none", "Выключен"],
          ["opencode", "OpenCode Zen (облако, платно)"],
          ["ollama", "Ollama (компьютер или облако, бесплатно)"],
          ["openrouter", "OpenRouter (есть бесплатные)"],
          ["gemini", "Google Gemini (бесплатно)"],
          ["groq", "Groq (бесплатно, очень быстро)"],
          ["cerebras", "Cerebras (бесплатно, очень быстро)"],
          ["github", "GitHub Models (вход через GitHub)"],
          ["huggingface", "Hugging Face"],
          ["mistral", "Mistral (бесплатный план)"],
          ["openai", "OpenAI-совместимый"],
          ["anthropic", "Claude (Anthropic)"],
        ],
      },
      {
        key: "tulpar.ai.model",
        label: "Модель",
        hint: "Название модели, как его понимает сервер.",
        type: "text",
        placeholder: () => provider()?.model || "название модели",
      },
      {
        key: "tulpar.ai.baseUrl",
        label: "Адрес сервера",
        hint: "Пусто — стандартный адрес.",
        type: "text",
        placeholder: () => provider()?.baseUrl ?? "",
      },
      {
        key: "tulpar.ai.apiKey",
        label: "Ключ API",
        hint: "Хранится открытым текстом в settings.json — не выкладывайте этот файл. Для Ollama не нужен.",
        type: "password",
      },
      {
        key: "tulpar.ai.inline",
        label: "Подсказки при наборе",
        hint: "Серый текст продолжения кода, Tab — принять. Лучше всего с Ollama и маленькой моделью для кода.",
        type: "toggle",
      },
      {
        key: "tulpar.ai.inlineProvider",
        label: "Подсказки берутся из",
        hint: "GitHub Copilot — официальный сервер Copilot от GitHub, работает и с бесплатным тарифом Copilot Free. Нужен вход в GitHub (кнопка ниже).",
        type: "select",
        options: [["model", "Модель ИИ выше"], ["copilot", "GitHub Copilot"]],
      },
      {
        key: "tulpar.ai.inlineModel",
        label: "Модель для подсказок",
        hint: "Быстрая модель только для подсказок, например qwen2.5-coder:1.5b. Пусто — та же, что выше.",
        type: "text",
        placeholder: "qwen2.5-coder:1.5b",
      },
      {
        key: "tulpar.ai.projectChars",
        label: "Объём «Весь проект» в чате",
        hint: "Сколько символов кода отдавать ИИ. У маленьких локальных моделей память меньше — для них лучше 20 000–40 000.",
        type: "number",
        min: 5000,
        max: 400000,
      },
      {
        key: "tulpar.ai.language",
        label: "Язык комментариев",
        hint: "На каком языке ИИ пишет комментарии и объяснения.",
        type: "text",
        placeholder: "как язык интерфейса",
      },
    ],
  },
  {
    id: "ai-actions",
    group: "ai",
    title: "Свои действия ИИ",
    intro: "Каждое действие появится в меню по правому клику и в палитре команд как «ИИ: название». Ответ заменит выделенный код или откроется в окне.",
    fields: [],
    extra: () => <CustomActions />,
    after: true,
  },
  {
    id: "ai-local",
    group: "ai",
    title: "Локальный ИИ",
    intro:
      "Модель работает на вашем компьютере: бесплатно, без интернета, код никуда не отправляется. Чем больше модель, тем она умнее и тем больше ей нужно памяти.",
    fields: [],
    extra: () => <LocalAi />,
    after: true,
  },
  {
    id: "keys",
    group: "system",
    title: "Горячие клавиши",
    intro: "Все действующие сочетания. Свои можно добавить в keybindings.json — кнопка «Клавиши» в разделе «Файлы и система».",
    fields: [],
    extra: (query) => <Keybindings query={query ?? ""} />,
    after: true,
    searchInExtra: true,
  },
  {
    id: "system",
    group: "system",
    title: "Файлы и система",
    fields: [],
    extra: () => (
      <>
        <div class="settings-row">
          <div class="settings-label">
            <span>Профиль настроек</span>
            <small>
              Один файл со всем своим: настройки, сочетания клавиш, сниппеты, раскладки и свои действия ИИ. Ключи API и путь к фону в файл не
              попадают.
            </small>
          </div>
          <div class="settings-control settings-buttons">
            <button class="button" onClick={() => void exportProfile()}>
              Экспорт…
            </button>
            <button class="button-quiet" onClick={() => void importProfile()}>
              Импорт…
            </button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <span>Синхронизация через GitHub</span>
            <small>
              Тот же профиль хранится в вашем секретном gist на GitHub. Поставили Tulpar на другой компьютер — вошли в GitHub и нажали «Скачать».
            </small>
          </div>
          <div class="settings-control settings-buttons">
            <button class="button" onClick={() => void uploadSettings()}>
              ☁ Сохранить в GitHub
            </button>
            <button class="button-quiet" onClick={() => void downloadSettings()}>
              Скачать из GitHub
            </button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <span>Настройки файлами</span>
            <small>Всё то же самое можно править в файлах — формат как в VS Code.</small>
          </div>
          <div class="settings-control settings-buttons wrap">
            {fileButton("settings.json", "workbench.action.openSettingsJson")}
            {fileButton("Клавиши", "workbench.action.openGlobalKeybindings")}
            {fileButton("Раскладка", "tulpar.openLayoutSettings")}
            {fileButton("Языки", "tulpar.openLanguageSettings")}
            {fileButton("Сниппеты", "workbench.action.openSnippets")}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <span>Мастер настройки</span>
            <small>Пройти первые шаги заново: дизайн, тема, ИИ.</small>
          </div>
          <div class="settings-control settings-buttons">{fileButton("Открыть мастер", "tulpar.onboarding")}</div>
        </div>
        <div class="settings-row">
          <div class="settings-label">
            <span>Сбросить все настройки</span>
            <small>Вернуть всё как после установки.</small>
          </div>
          <div class="settings-control settings-buttons">
            <button class="button-quiet danger" onClick={() => void resetSettings()}>
              Сбросить
            </button>
          </div>
        </div>
      </>
    ),
  }
];

/** Разделы в порядке групп: ИИ, код, оформление, инструменты, система. */
/** Новые настройки «Фишек» (раньше их не было в окне). */
const funFields: FieldDef[] = [
  { key: "tulpar.fun.powerMode", label: "Power mode", hint: "Искры из-под курсора при наборе; «с тряской» — ещё и лёгкая тряска экрана на быстром наборе.", type: "select", options: [["off", "Выключен"], ["sparks", "Искры"], ["shake", "Искры и тряска"]] },
  { key: "tulpar.fun.combo", label: "Счётчик комбо", hint: "Большая цифра в углу, когда печатаете без остановки (только с Power mode).", type: "toggle" },
  { key: "tulpar.fun.achievements", label: "Всплывающие ачивки", hint: "Достижения всё равно копятся — выключается только всплывашка с конфетти.", type: "toggle" },
  { key: "tulpar.present.scale", label: "Режим презентации: увеличение", type: "range", min: 1.2, max: 2.5, step: 0.1, show: (v) => `×${v.toFixed(1)}` },
  { key: "tulpar.voice.language", label: "Язык для кода голосом", type: "select", options: [["auto", "Как интерфейс"], ["ru-RU", "Русский"], ["kk-KZ", "Қазақша"], ["en-US", "English"]] },
  { key: "tulpar.stats.enabled", label: "Считать время за кодом", hint: "Для «Моей статистики» и ачивок. Данные только на этом компьютере.", type: "toggle" },
  { key: "tulpar.history.enabled", label: "Машина времени", hint: "Копия файла при каждом сохранении и перед правками ИИ — локально, даже без git.", type: "toggle" },
  { key: "tulpar.history.perFile", label: "Сколько версий хранить на файл", type: "number", min: 5, max: 500 },
  { key: "tulpar.lowEnd", label: "Режим для слабых ПК", hint: "Выключает анимации, размытие, мини-карту, цветные скобки и подсказки ИИ при наборе. Выключите — всё вернётся как было.", type: "toggle" },
];

type Layout = { id: string; group: GroupId; title: string; intro?: Text; keys: string[]; extraFrom?: string; extra?: () => JSX.Element };

/** Как настройки разложены по разделам: короткие разделы по смыслу. */
const LAYOUT: Layout[] = [
  { id: "general", group: "general", title: "Основное", keys: ["workbench.language", "tulpar.lowEnd", "files.autoSave", "tulpar.update.check", "tulpar.chat.location"] },
  { id: "saving", group: "general", title: "Сохранение файлов", keys: ["editor.formatOnSave", "files.trimTrailingWhitespace", "files.insertFinalNewline"] },
  { id: "text", group: "code", title: "Текст и шрифт", keys: ["editor.fontSize", "editor.fontFamily", "editor.lineHeight", "editor.fontLigatures", "editor.wordWrap", "editor.mouseWheelZoom"] },
  { id: "cursor", group: "code", title: "Курсор и прокрутка", keys: ["editor.cursorStyle", "editor.cursorBlinking", "editor.renderLineHighlight", "editor.cursorSurroundingLines", "editor.smoothScrolling"] },
  { id: "indent", group: "code", title: "Отступы и скобки", keys: ["editor.tabSize", "editor.insertSpaces", "editor.autoClosingBrackets", "editor.bracketPairColorization.enabled", "editor.guides.indentation", "editor.renderWhitespace", "editor.rulers"] },
  { id: "helpers", group: "code", title: "Подсказки на экране", keys: ["editor.lineNumbers", "editor.minimap.enabled", "editor.stickyScroll.enabled", "breadcrumbs.enabled", "editor.folding", "editor.occurrencesHighlight", "git.blame.inline"] },
  { id: "terminal", group: "code", title: "Терминал", keys: ["terminal.integrated.shell", "terminal.integrated.fontSize", "terminal.integrated.fontFamily", "terminal.integrated.cursorStyle", "terminal.integrated.scrollback"] },
  {
    id: "theme",
    group: "look",
    title: "Тема",
    keys: ["workbench.colorTheme"],
    extra: () => (
      <div class="settings-row">
        <div class="settings-label">
          <span>Галерея тем</span>
          <small>Сотни тем VS Code из Open VSX с предпросмотром.</small>
        </div>
        <div class="settings-control settings-buttons">
          <button class="button" onClick={() => { setSettingsVisible(false); void executeCommand("tulpar.themes.gallery"); }}>Открыть галерею…</button>
        </div>
      </div>
    ),
  },
  { id: "layout", group: "look", title: "Интерфейс", keys: ["workbench.style", "workbench.islands", "workbench.activityBar", "workbench.tabs.style", "workbench.radius", "workbench.gap", "workbench.uiFontSize", "workbench.statusBar.visible", "workbench.sidebar.autoHide"] },
  { id: "background", group: "look", title: "Фон и прозрачность", extraFrom: "appearance", keys: ["tulpar.background.mode", "workbench.panelOpacity", "workbench.panelBlur", "tulpar.background.opacity", "tulpar.background.blur", "tulpar.background.fit"] },
  { id: "ai", group: "ai", title: "Модель и подключение", extraFrom: "ai", keys: ["tulpar.ai.provider", "tulpar.ai.model", "tulpar.ai.baseUrl", "tulpar.ai.apiKey"] },
  { id: "agent", group: "ai", title: "Чат и агент", keys: ["tulpar.agent.approve", "tulpar.agent.maxSteps", "tulpar.ai.projectChars", "tulpar.ai.language"] },
  { id: "inline", group: "ai", title: "Подсказки при наборе", keys: ["tulpar.ai.inline", "tulpar.ai.inlineProvider", "tulpar.ai.inlineModel"] },
  { id: "ai-actions", group: "ai", title: "Свои действия ИИ", extraFrom: "ai-actions", keys: [] },
  { id: "ai-local", group: "ai", title: "Локальный ИИ", extraFrom: "ai-local", keys: ["tulpar.ai.contextSize", "tulpar.ai.think"] },
  { id: "fun", group: "fun", title: "Игры и фан", keys: ["tulpar.fun.powerMode", "tulpar.fun.combo", "tulpar.fun.achievements", "tulpar.present.scale", "tulpar.voice.language"] },
  { id: "privacy", group: "fun", title: "Статистика и история", intro: "Всё хранится только на этом компьютере — Tulpar ничего не отправляет.", keys: ["tulpar.stats.enabled", "tulpar.history.enabled", "tulpar.history.perFile"] },
  { id: "tools", group: "system", title: "SDK и инструменты", extraFrom: "tools", keys: [] },
  { id: "keys", group: "system", title: "Горячие клавиши", extraFrom: "keys", keys: [] },
  { id: "system", group: "system", title: "Файлы и система", extraFrom: "system", keys: [] },
];

const sections: Section[] = (() => {
  const all = new Map<string, FieldDef>([...sectionList.flatMap((sec) => sec.fields), ...funFields].map((f) => [f.key, f]));
  const byId = new Map(sectionList.map((sec) => [sec.id, sec]));
  const placed = new Set(LAYOUT.flatMap((l) => l.keys));
  const built = LAYOUT.map((l): Section => {
    const src = l.extraFrom ? byId.get(l.extraFrom) : undefined;
    return {
      id: l.id,
      group: l.group,
      title: l.title,
      intro: l.intro ?? src?.intro,
      fields: l.keys.map((k) => all.get(k)).filter((f): f is FieldDef => !!f),
      extra: l.extra ?? src?.extra,
      after: src?.after,
      searchInExtra: src?.searchInExtra,
    };
  });
  // Ничего не теряем: всё, что не разложено, — в «Файлы и система»
  const rest = [...all.values()].filter((f) => !placed.has(f.key));
  if (rest.length) built.find((x) => x.id === "system")!.fields.push(...rest);
  return built;
})();

function Control(props: { def: FieldDef }) {
  const def = props.def;
  const value = () => settings()[def.key];
  const set = (v: unknown) => {
    if (def.key === "tulpar.ai.provider") return switchService(String(v));
    updateSetting(def.key, v as Settings[typeof def.key]);
    // Дизайн 2 задуман с темами Tulpar: с классической темой он выглядит чужим.
    if (def.key === "workbench.style" && v === "tulpar") {
      const theme = settings()["workbench.colorTheme"];
      if (theme === "dark" || theme === "light") updateSetting("workbench.colorTheme", theme === "light" ? "dawn" : "steppe");
    }
  };

  switch (def.type) {
    case "toggle":
      return (
        <label class="switch">
          <input type="checkbox" checked={Boolean(value())} onChange={(e) => set(e.currentTarget.checked)} />
          <span />
        </label>
      );
    case "select":
      return (
        <select class="settings-input" onChange={(e) => set(e.currentTarget.value)}>
          <For each={typeof def.options === "function" ? def.options() : def.options}>
            {([v, label]) => (
              <option value={v} selected={v === String(value())}>
                {label}
              </option>
            )}
          </For>
        </select>
      );
    case "number":
      return (
        <input
          class="settings-input settings-number"
          type="number"
          min={def.min}
          max={def.max}
          value={Number(value())}
          onChange={(e) => {
            const n = Number(e.currentTarget.value);
            const clamped = Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : def.min;
            e.currentTarget.value = String(clamped);
            set(clamped);
          }}
        />
      );
    case "range":
      return (
        <div class="settings-range">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={Number(value())}
            onInput={(e) => set(Number(e.currentTarget.value))}
          />
          <span>{def.show(Number(value()))}</span>
        </div>
      );
    default:
      return (
        <input
          class="settings-input"
          type={def.type}
          value={String(value() ?? "")}
          placeholder={resolve(def.placeholder)}
          spellcheck={false}
          autocomplete="off"
          onChange={(e) => {
            const text = e.currentTarget.value.trim();
            // Пустая оболочка терминала — это «по умолчанию»
            set(def.key === "terminal.integrated.shell" && !text ? null : text);
          }}
        />
      );
  }
}

/** Подходит ли поле под строку поиска. */
function matches(def: FieldDef, q: string): boolean {
  return [def.label, resolve(def.hint) ?? "", def.key].some((t) => t.toLowerCase().includes(q));
}

function Panel() {
  const [query, setQuery] = createSignal("");
  const [onlyChanged, setOnlyChanged] = createSignal(false);
  const [active, setActive] = createSignal(sections.some((x) => x.id === settingsSection()) ? settingsSection() : "general");
  onCleanup(() => setSettingsSection("general"));

  const q = () => query().trim().toLowerCase();
  const filtering = () => Boolean(q()) || onlyChanged();

  const isChanged = (def: FieldDef) => !sameValue(settings()[def.key], defaultSettings[def.key]);
  const matchTitle = (section: Section) => Boolean(q()) && section.title.toLowerCase().includes(q());
  const visibleFields = (section: Section) =>
    matchTitle(section)
      ? section.fields.filter((f) => !onlyChanged() || isChanged(f))
      : section.fields.filter((f) => (!onlyChanged() || isChanged(f)) && (!q() || matches(f, q())));
  const sectionVisible = (section: Section) =>
    filtering()
      ? matchTitle(section) || visibleFields(section).length > 0 || Boolean(q() && section.searchInExtra)
      : section.id === active();
  /** В списке слева при обычном просмотре видны все разделы, при поиске — только найденные. */
  const navVisible = (section: Section) => (!filtering() ? true : sectionVisible(section));
  const changedIn = (section: Section) => section.fields.filter(isChanged).length;
  const changedTotal = () => sections.reduce((n, section) => n + changedIn(section), 0);
  const found = () => sections.reduce((n, section) => n + visibleFields(section).length, 0);
  const current = () => sections.find((section) => section.id === active()) ?? sections[0];

  let pane: HTMLDivElement | undefined;
  const close = () => {
    setSettingsVisible(false);
    focusEditor();
  };
  const open = (id: string) => {
    setActive(id);
    setQuery("");
    setOnlyChanged(false);
    pane?.scrollTo({ top: 0 });
  };
  const resetSection = (section: Section) => {
    const dirty = section.fields.filter(isChanged);
    if (!dirty.length) return;
    for (const def of dirty) updateSetting(def.key, defaultSettings[def.key] as Settings[typeof def.key]);
    notify(`«${section.title}»: возвращены стандартные значения (${dirty.length})`);
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const row = (def: FieldDef) => (
    <div class="settings-row" classList={{ changed: isChanged(def) }}>
      <div class="settings-label">
        <span class="settings-name">
          {def.label}
          <Show when={isChanged(def)}>
            <span class="settings-dot" title="Отличается от стандартного значения" />
          </Show>
        </span>
        <Show when={def.hint}>
          <small>{resolve(def.hint)}</small>
        </Show>
      </div>
      <div class="settings-control">
        <Control def={def} />
      </div>
    </div>
  );

  const renderSection = (section: Section) => (
    <section class="settings-section" classList={{ framed: filtering() }}>
      <header class="settings-section-head">
        <div>
          <h2>{section.title}</h2>
          <Show when={section.intro}>
            <p class="settings-intro">{resolve(section.intro)}</p>
          </Show>
        </div>
        <Show when={changedIn(section) > 0}>
          <button
            class="settings-reset"
            title="Вернуть значение этого раздела к стандартному"
            onClick={() => resetSection(section)}
          >
            Сбросить
            <span class="settings-reset-count">{changedIn(section)}</span>
          </button>
        </Show>
      </header>
      <Show when={section.extra && !section.after && (!filtering() || matchTitle(section) || section.searchInExtra)}>
        {section.extra?.(q())}
      </Show>
      <For each={visibleFields(section)}>{(def) => row(def)}</For>
      <Show when={section.extra && section.after && (!filtering() || matchTitle(section) || section.searchInExtra)}>
        {section.extra?.(q())}
      </Show>
    </section>
  );

  return (
    <div class="dialog-backdrop" onMouseDown={close}>
      <div class="dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <header class="dialog-header settings-head">
          <span class="settings-title">Настройки</span>
          <div class="settings-toolbar">
            <input
              class="settings-input settings-search"
              placeholder="Поиск: шрифт, тема, ИИ…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              ref={(el) => setTimeout(() => el.focus(), 50)}
            />
            <button
              class="settings-chip"
              classList={{ on: onlyChanged() }}
              title="Показать только настройки, которые отличаются от стандартных"
              onClick={() => setOnlyChanged((v) => !v)}
            >
              Изменённые
              <Show when={changedTotal() > 0}>
                <span class="settings-chip-count">{changedTotal()}</span>
              </Show>
            </button>
          </div>
          <div class="dialog-actions">
            <button
              class="button-quiet"
              title="Те же настройки в виде файла"
              onClick={() => {
                close();
                void executeCommand("workbench.action.openSettingsJson");
              }}
            >
              settings.json
            </button>
            <button class="button-quiet" onClick={close}>
              Закрыть
            </button>
          </div>
        </header>

        <div class="settings-main">
          <nav class="settings-rail" aria-label="Разделы настроек">
            <For each={groups}>
              {(group) => (
                <Show when={sections.some((section) => section.group === group.id && navVisible(section))}>
                  <div class="settings-group">
                    <div class="settings-group-title">
                      {group.icon(14)}
                      <span>{group.title}</span>
                    </div>
                    <For each={sections.filter((section) => section.group === group.id)}>
                      {(section) => (
                        <Show when={navVisible(section)}>
                          <button
                            class="settings-tab"
                            classList={{ active: !filtering() && section.id === active() }}
                            onClick={() => open(section.id)}
                          >
                            <span class="settings-tab-title">{section.title}</span>
                            <Show when={changedIn(section) > 0}>
                              <span class="settings-dot" title={`Изменено настроек: ${changedIn(section)}`} />
                            </Show>
                          </button>
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>
              )}
            </For>
          </nav>

          <div class="settings-pane" ref={(el) => (pane = el)}>
            <Show when={filtering()}>
              <p class="settings-found">{found() ? `Найдено настроек: ${found()}` : "Ничего не найдено. Попробуйте другое слово."}</p>
            </Show>
            <Show when={!filtering()}>{renderSection(current())}</Show>
            <Show when={filtering()}>
              <For each={sections.filter((section) => sectionVisible(section))}>{(section) => renderSection(section)}</For>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsView() {
  return (
    <Show when={settingsVisible()}>
      <Panel />
    </Show>
  );
}
