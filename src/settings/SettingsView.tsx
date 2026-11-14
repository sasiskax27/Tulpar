// Окно настроек (Ctrl+,). Каждое изменение применяется сразу и записывается
// в settings.json — тот же файл можно править и руками.
import { For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { settings, updateSetting, type Settings } from "../config/store";
import { settingsVisible, setSettingsVisible } from "../app/ui";
import { executeCommand } from "../commands/registry";
import { chooseBackground, clearBackground, usePhotoTheme } from "../app/background";
import { providers } from "../ai/ai";
import { focusEditor } from "../editor/instance";
import { baseName } from "../ipc";
import LocalAi from "./LocalAi";
import { THEME_NAMES } from "../app/themes";
import CustomActions from "./CustomActions";

type Text = string | (() => string);

type FieldDef = { key: keyof Settings & string; label: string; hint?: Text } & (
  | { type: "number"; min: number; max: number }
  | { type: "range"; min: number; max: number; step: number; show: (v: number) => string }
  | { type: "text"; placeholder?: Text }
  | { type: "password"; placeholder?: Text }
  | { type: "select"; options: [value: string, label: string][] }
  | { type: "toggle" }
);

interface Section {
  title: string;
  intro?: Text;
  fields: FieldDef[];
  extra?: () => JSX.Element;
  /** Показать extra после полей, а не перед ними */
  after?: boolean;
}

const resolve = (t: Text | undefined) => (typeof t === "function" ? t() : t);
const provider = () => providers[String(settings()["tulpar.ai.provider"])];

const sections: Section[] = [
  {
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
    ],
  },
  {
    title: "Внешний вид",
    fields: [
      {
        key: "workbench.style",
        label: "Стиль интерфейса",
        hint: "Дизайн 2 — верхняя панель с ИИ-островом, боковая панель выезжает при наведении на левый край.",
        type: "select",
        options: [["classic", "Дизайн 1 — полоса иконок"], ["tulpar", "Дизайн 2 — Tulpar"]],
      },
      { key: "workbench.colorTheme", label: "Тема", type: "select", options: THEME_NAMES },
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
            <span>Фоновая картинка</span>
            <small>{image() ? baseName(image()!) : "Можно просто перетащить картинку в окно Tulpar."}</small>
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
    ],
  },
  {
    title: "ИИ",
    intro:
      "Выделите код, нажмите правую кнопку мыши и выберите действие «ИИ: …». Код отправляется только на сервер, указанный здесь, и только по вашей команде.",
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
        key: "tulpar.ai.provider",
        label: "Какой ИИ использовать",
        hint: () =>
          ({
            none: "ИИ выключен.",
            ollama: "Бесплатно и без интернета: модель работает на вашем компьютере. Нужна установленная Ollama.",
            openai: "Любой сервис с OpenAI-совместимым API: OpenAI, OpenRouter, LM Studio и другие.",
            anthropic: "Claude через API. Нужен ключ API из консоли Anthropic.",
          })[String(settings()["tulpar.ai.provider"])] ?? "",
        type: "select",
        options: [["none", "Выключен"], ["ollama", "Ollama (локально)"], ["openai", "OpenAI-совместимый"], ["anthropic", "Claude (Anthropic)"]],
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
        placeholder: "русский",
      },
    ],
  },
  {
    title: "Свои действия ИИ",
    intro: "Каждое действие появится в меню по правому клику и в палитре команд как «ИИ: название». Ответ заменит выделенный код или откроется в окне.",
    fields: [],
    extra: () => <CustomActions />,
    after: true,
  },
  {
    title: "Локальный ИИ",
    intro:
      "Модель работает на вашем компьютере: бесплатно, без интернета, код никуда не отправляется. Чем больше модель, тем она умнее и тем больше ей нужно памяти.",
    fields: [],
    extra: () => <LocalAi />,
    after: true,
  },
];

function Control(props: { def: FieldDef }) {
  const def = props.def;
  const value = () => settings()[def.key];
  const set = (v: unknown) => {
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
          <For each={def.options}>
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

function Panel() {
  const close = () => {
    setSettingsVisible(false);
    focusEditor();
  };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="dialog-backdrop" onMouseDown={close}>
      <div class="dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <div class="dialog-header">
          <span>Настройки</span>
          <div class="dialog-actions">
            <button
              class="button-quiet"
              title="Те же настройки в виде файла"
              onClick={() => {
                close();
                void executeCommand("workbench.action.openSettingsJson");
              }}
            >
              Открыть settings.json
            </button>
            <button class="button-quiet" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
        <div class="settings-body">
          <For each={sections}>
            {(section) => (
              <section class="settings-section">
                <h2>{section.title}</h2>
                <Show when={section.intro}>
                  <p class="settings-intro">{resolve(section.intro)}</p>
                </Show>
                <Show when={!section.after}>{section.extra?.()}</Show>
                <For each={section.fields}>
                  {(def) => (
                    <div class="settings-row">
                      <div class="settings-label">
                        <span>{def.label}</span>
                        <Show when={def.hint}>
                          <small>{resolve(def.hint)}</small>
                        </Show>
                      </div>
                      <div class="settings-control">
                        <Control def={def} />
                      </div>
                    </div>
                  )}
                </For>
                <Show when={section.after}>{section.extra?.()}</Show>
              </section>
            )}
          </For>
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
