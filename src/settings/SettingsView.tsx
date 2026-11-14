// Окно настроек (Ctrl+,). Каждое изменение применяется сразу и записывается
// в settings.json — тот же файл можно править и руками.
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ask } from "@tauri-apps/plugin-dialog";
import { settings, updateSetting, type Settings } from "../config/store";
import { settingsVisible, setSettingsVisible } from "../app/ui";
import { executeCommand } from "../commands/registry";
import { chooseBackground, clearBackground, usePhotoTheme } from "../app/background";
import { providers } from "../ai/ai";
import { focusEditor } from "../editor/instance";
import { baseName, core } from "../ipc";
import { pick } from "../app/QuickPick";
import { notify, notifyError } from "../app/notify";
import LocalAi from "./LocalAi";
import Toolchains from "./Toolchains";
import { copilotSignIn, copilotSignOut, copilotState, copilotUser } from "../ai/copilot";
import { claudeModels, cloudCatalog, openaiModels, opencodeModels } from "../ai/models";
import { installed, isInstalled } from "../ai/ollama";
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
    default:
      return null;
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
        key: "editor.cursorStyle",
        label: "Вид курсора",
        type: "select",
        options: [["line", "Полоска"], ["line-thin", "Тонкая полоска"], ["block", "Блок"], ["underline", "Подчёркивание"]],
      },
      { key: "editor.fontLigatures", label: "Лигатуры шрифта", hint: "=> != === рисуются одним знаком, если шрифт это умеет (JetBrains Mono, Fira Code).", type: "toggle" },
      { key: "editor.bracketPairColorization.enabled", label: "Цветные скобки", hint: "Парные скобки разными цветами.", type: "toggle" },
      { key: "editor.stickyScroll.enabled", label: "Липкие заголовки", hint: "Строка с началом функции или класса остаётся наверху при прокрутке.", type: "toggle" },
      { key: "editor.guides.indentation", label: "Линии отступов", type: "toggle" },
      { key: "breadcrumbs.enabled", label: "Хлебные крошки", hint: "Над кодом: путь файла и функция, в которой стоит курсор.", type: "toggle" },
      { key: "editor.folding", label: "Сворачивание блоков", hint: "Стрелки слева от кода, чтобы скрыть функцию или цикл.", type: "toggle" },
      {
        key: "editor.renderWhitespace",
        label: "Показывать пробелы",
        type: "select",
        options: [["none", "Нет"], ["selection", "В выделении"], ["boundary", "По краям слов"], ["all", "Все"]],
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
    title: "SDK и инструменты",
    intro: "Языки и сборщики для запуска проектов: если чего-то нет — установка одной кнопкой (во вкладке терминала).",
    fields: [],
    extra: () => <Toolchains />,
  },
  {
    title: "ИИ",
    intro:
      "Выделите код, нажмите правую кнопку мыши и выберите действие «ИИ: …». Код отправляется только на сервер, указанный здесь, и только по вашей команде.",
    extra: () => (
      <>
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
          })[String(settings()["tulpar.ai.provider"])] ?? "",
        type: "select",
        options: [
          ["none", "Выключен"],
          ["opencode", "OpenCode Zen (облако, платно)"],
          ["ollama", "Ollama (компьютер или облако, бесплатно)"],
          ["openrouter", "OpenRouter (есть бесплатные)"],
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
  {
    title: "Файлы настроек и прочее",
    fields: [],
    extra: () => (
      <>
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

/** Подходит ли поле под строку поиска. */
function matches(def: FieldDef, q: string): boolean {
  return [def.label, resolve(def.hint) ?? "", def.key].some((t) => t.toLowerCase().includes(q));
}

function Panel() {
  const [query, setQuery] = createSignal("");
  const q = () => query().trim().toLowerCase();
  const visibleFields = (section: Section) =>
    !q() || section.title.toLowerCase().includes(q()) ? section.fields : section.fields.filter((f) => matches(f, q()));
  const sectionVisible = (section: Section) =>
    !q() || section.title.toLowerCase().includes(q()) || visibleFields(section).length > 0;
  let body: HTMLDivElement | undefined;
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
          <input
            class="settings-input settings-search"
            placeholder="Поиск настроек: шрифт, тема, ИИ…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            ref={(el) => setTimeout(() => el.focus(), 50)}
          />
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
        <Show when={!q()}>
          <nav class="settings-nav">
            <For each={sections}>
              {(section, i) => (
                <button
                  class="settings-nav-item"
                  onClick={() => body?.querySelector(`[data-section="${i()}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                >
                  {section.title}
                </button>
              )}
            </For>
          </nav>
        </Show>
        <div class="settings-body" ref={body}>
          <Show when={q() && !sections.some(sectionVisible)}>
            <p class="settings-intro">Ничего не найдено.</p>
          </Show>
          <For each={sections}>
            {(section, i) => (
              <Show when={sectionVisible(section)}>
              <section class="settings-section" data-section={i()}>
                <h2>{section.title}</h2>
                <Show when={section.intro}>
                  <p class="settings-intro">{resolve(section.intro)}</p>
                </Show>
                <Show when={!section.after && (!q() || section.title.toLowerCase().includes(q()))}>{section.extra?.()}</Show>
                <For each={visibleFields(section)}>
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
                <Show when={section.after && (!q() || section.title.toLowerCase().includes(q()))}>{section.extra?.()}</Show>
              </section>
              </Show>
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
