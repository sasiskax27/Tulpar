// Стартовый экран: приветствие, «создать с ИИ», новые проекты из шаблонов,
// недавние проекты и главные действия.
import { createSignal, For, onCleanup, Show } from "solid-js";
import { executeCommand } from "../commands/registry";
import { keybindingFor } from "../keybindings/keybindings";
import { forgetRecent, openFolder, recent, root } from "../app/workspace";
import { baseName, parentDir } from "../ipc";
import { settings } from "../config/store";
import { TEMPLATES, createProject, type Template } from "../app/templates";
import { folderColor } from "../explorer/icons";
import { send, setAgentMode } from "../ai/chat";
import { currentLang } from "../i18n/translate";

const TIPS = [
  ["Ctrl+P", "найти любой файл по имени"],
  ["Ctrl+Shift+P", "все команды Tulpar"],
  ["Ctrl+K Z", "режим фокуса — только код"],
  ["Ctrl+I", "попросить ИИ переделать выделенный код"],
  ["Ctrl+F5", "запустить текущий файл"],
  ["Ctrl+Shift+B", "задачи проекта: сборка, тесты"],
  ["Ctrl+`", "открыть терминал"],
  ["Ctrl+Shift+X", "темы VS Code из Open VSX"],
  ["Ctrl+R", "открыть недавний проект"],
  ["Ctrl+,", "настройки"],
  ["Ctrl+Alt+I", "открыть чат с ИИ"],
] as const;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

const IDEAS = ["игра «Змейка» на Python", "сайт-портфолио", "Telegram-бот", "калькулятор на Java", "TODO-приложение на React"];

export default function Welcome() {
  const [prompt, setPrompt] = createSignal("");
  const [tip, setTip] = createSignal(Math.floor(Math.random() * TIPS.length));
  const [busy, setBusy] = createSignal(false);
  const timer = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 7000);
  onCleanup(() => clearInterval(timer));

  const recentList = () => recent().filter((p) => p !== root()).slice(0, 6);
  const aiReady = () => settings()["tulpar.ai.provider"] !== "none";
  const kb = (cmd: string) => keybindingFor(cmd) ?? "";

  const createWithAi = async () => {
    const text = prompt().trim();
    if (!text) return;
    if (!aiReady()) {
      void executeCommand("workbench.action.openSettings");
      return;
    }
    setBusy(true);
    try {
      // Без открытой папки — сначала создаём папку для проекта
      if (!root()) {
        const suggested = text
          .toLowerCase()
          .replace(/[^a-zа-яё0-9]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 30);
        const ok = await createProject(null, /^[a-z0-9-]+$/.test(suggested) && suggested ? suggested : "my-app");
        if (!ok) return;
      }
      setAgentMode(true);
      await executeCommand("workbench.action.chat.open");
      setPrompt("");
      await send(`Создай в этой папке проект: ${text}. Сделай рабочий минимальный вариант, потом коротко скажи, как его запустить.`);
    } finally {
      setBusy(false);
    }
  };

  const action = (title: string, command: string, icon: string) => (
    <button class="start-action" onClick={() => void executeCommand(command)}>
      <span class="start-action-icon" aria-hidden="true">
        {icon}
      </span>
      <span class="start-action-title">{title}</span>
      <kbd>{kb(command)}</kbd>
    </button>
  );

  return (
    <div class="welcome start">
      <div class="start-inner">
        <header class="start-hero">
          <div class="start-mark" aria-hidden="true">
            T
          </div>
          <div>
            <h1>{greeting()}</h1>
            <p>Tulpar — быстрый редактор кода с ИИ. Что делаем сегодня?</p>
          </div>
        </header>

        <section class="start-ai">
          <div class="start-ai-box">
            <span class="start-ai-spark" aria-hidden="true">
              ✦
            </span>
            <input
              placeholder={aiReady() ? "Опишите, что создать, — ИИ-агент соберёт проект" : "Подключите ИИ, и он будет собирать проекты по описанию"}
              aria-label="Что создать с ИИ"
              value={prompt()}
              disabled={busy()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createWithAi();
              }}
            />
            <button class="button" disabled={busy() || (aiReady() && !prompt().trim())} onClick={() => void createWithAi()}>
              {aiReady() ? (root() ? "Сделать здесь" : "Создать") : "Подключить ИИ"}
            </button>
          </div>
          <Show when={aiReady()}>
            <div class="start-ideas">
              <For each={IDEAS}>
                {(idea) => (
                  <button class="start-idea" onClick={() => setPrompt(idea)}>
                    {idea}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section>
          <div class="start-title">Новый проект</div>
          <div class="start-templates">
            <For each={TEMPLATES}>
              {(t: Template) => (
                <button class="start-template" onClick={() => void createProject(t)} title={t.hint}>
                  <span class="start-badge" style={{ background: t.color + "26", color: t.color, "border-color": t.color + "55" }}>
                    {t.badge}
                  </span>
                  <span class="start-template-text">
                    <span class="start-template-title">{t.title}</span>
                    <span class="start-template-hint">{t.hint}</span>
                  </span>
                </button>
              )}
            </For>
            <button class="start-template ghost" onClick={() => void createProject(null)} title="Пустая папка">
              <span class="start-badge">+</span>
              <span class="start-template-text">
                <span class="start-template-title">Пустой</span>
                <span class="start-template-hint">Только папка</span>
              </span>
            </button>
          </div>
        </section>

        <div class="start-columns">
          <section class="start-col">
            <div class="start-title">Недавние</div>
            <Show
              when={recentList().length}
              fallback={<p class="start-empty">Здесь появятся проекты, которые вы открывали.</p>}
            >
              <For each={recentList()}>
                {(path) => (
                  <div class="start-recent">
                    <button class="start-recent-open" title={path} onClick={() => void openFolder(path)}>
                      <span class="start-folder" style={{ color: folderColor(baseName(path)) }} aria-hidden="true">
                        ▰
                      </span>
                      <span class="start-recent-text">
                        <span class="start-recent-name" data-no-translate>
                          {baseName(path)}
                        </span>
                        <span class="start-recent-path" data-no-translate>
                          {parentDir(path)}
                        </span>
                      </span>
                    </button>
                    <button class="welcome-forget" title="Убрать из списка" onClick={() => forgetRecent(path)}>
                      ×
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </section>

          <section class="start-col">
            <div class="start-title">Начать</div>
            {action("Открыть папку", "workbench.action.files.openFolder", "📂")}
            {action("Клонировать с GitHub", "git.clone", "⤓")}
            {action("Учиться программировать", "tulpar.learn", "🎓")}
            {action("Код в видео", "tulpar.video.studio", "🎬")}
            {action("Карта проекта", "tulpar.projectMap", "🗺")}
            {action("Телефон — второй экран", "tulpar.phone", "📱")}
            {action("Чат с ИИ", "workbench.action.chat.open", "✦")}
            {action("Библиотеки", "workbench.view.packages", "📦")}
            {action("Галерея тем", "tulpar.themes.gallery", "🎨")}
            {action("HTTP-клиент", "tulpar.http", "🌐")}
            {action("Доска TODO", "tulpar.todo", "📋")}
            {action("Моя статистика", "tulpar.stats", "📊")}
            {action("Вместе по сети", "tulpar.collab", "👥")}
            {action("ИИ-ревью проекта", "tulpar.review", "🔍")}
            {action("Битва с ИИ", "tulpar.battle", "⚔️")}
            {action("Достижения", "tulpar.achievements", "🏆")}
            {action("Настройки", "workbench.action.openSettings", "⚙")}
          </section>
        </div>

        <footer class="start-tip">
          <kbd>{TIPS[tip()][0]}</kbd> — <span>{TIPS[tip()][1]}</span>
          <span class="start-dot">·</span>
          <button class="start-link" onClick={() => void executeCommand("tulpar.onboarding")}>
            {currentLang() === "en" ? "Setup wizard" : "Мастер настройки"}
          </button>
        </footer>
      </div>
    </div>
  );
}
