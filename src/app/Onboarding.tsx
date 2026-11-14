// Мастер первого запуска: дизайн, тема и ИИ за три шага. Каждый выбор
// применяется сразу — видно, как меняется Tulpar за окном мастера.
import { currentLang } from "../i18n/translate";
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { settings, updateSetting } from "../config/store";
import { THEME_NAMES, themePreview } from "./themes";
import { executeCommand } from "../commands/registry";
import { catalog } from "../ai/models";
import { fitOf, initLocalAi, install, isInstalled, memory, progress, running, useModel } from "../ai/ollama";
import { runInTerminal } from "../terminal/sessions";
import { setSettingsVisible } from "./ui";

const DONE_KEY = "tulpar.onboarded";
const [open, setOpen] = createSignal(false);

/** Показать мастер, если Tulpar запущен впервые. */
export function maybeShowOnboarding() {
  try {
    if (!localStorage.getItem(DONE_KEY)) setOpen(true);
  } catch {
    // хранилище недоступно — не показываем
  }
}

export function showOnboarding() {
  setOpen(true);
}

function finish() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // ничего
  }
  setOpen(false);
}

type AiChoice = "cloud" | "local" | "key" | "none";

function DesignCard(props: { value: "classic" | "tulpar"; title: string; text: string }) {
  const active = () => (settings()["workbench.style"] ?? "classic") === props.value;
  return (
    <button
      class="ob-card"
      classList={{ active: active() }}
      onClick={() => {
        updateSetting("workbench.style", props.value);
        const t = settings()["workbench.colorTheme"];
        if (props.value === "tulpar" && (t === "dark" || t === "light")) updateSetting("workbench.colorTheme", "steppe");
      }}
    >
      <div class={`ob-mock ob-mock-${props.value}`}>
        <Show when={props.value === "classic"} fallback={<><i class="m-top" /><i class="m-island" /><i class="m-code" /></>}>
          <i class="m-bar" />
          <i class="m-side" />
          <i class="m-code" />
        </Show>
      </div>
      <b>{props.title}</b>
      <small>{props.text}</small>
    </button>
  );
}

function ThemeCard(props: { id: string; title: string }) {
  const c = () => themePreview(props.id);
  const active = () => settings()["workbench.colorTheme"] === props.id;
  return (
    <button class="ob-card ob-theme" classList={{ active: active() }} onClick={() => updateSetting("workbench.colorTheme", props.id as never)}>
      <div class="ob-swatch" style={{ background: c().bg }}>
        <span style={{ color: c().kw }}>def</span> <span style={{ color: c().accent }}>hello</span>
        <span style={{ color: c().text }}>(</span>
        <span style={{ color: c().str }}>"мир"</span>
        <span style={{ color: c().text }}>)</span>
        <i style={{ background: c().island }} />
      </div>
      <b>{props.title}</b>
    </button>
  );
}

export default function Onboarding() {
  const [step, setStep] = createSignal(0);
  const [ai, setAi] = createSignal<AiChoice | null>(null);
  onMount(() => void initLocalAi().catch(() => undefined));

  // Лучшая локальная модель для этого компьютера
  const localPick = createMemo(() => {
    const fast = catalog.filter((m) => fitOf(m) === "fast");
    const pool = fast.length ? fast : catalog.filter((m) => fitOf(m) === "slow" && m.sizeGb <= 5);
    return pool.reduce<(typeof catalog)[number] | undefined>((best, m) => (!best || m.sizeGb > best.sizeGb ? m : best), undefined) ?? catalog[6];
  });
  const weakPc = () => {
    const { ramGb, vramGb } = memory();
    return ramGb !== null && ramGb < 12 && (vramGb ?? 0) < 6;
  };

  const steps = ["Привет", "Дизайн", "Тема", "ИИ", "Готово"];

  return (
    <Show when={open()}>
      <div class="ob-backdrop">
        <div class="ob-dialog" role="dialog" aria-modal="true" aria-label="Настройка Tulpar">
          <div class="ob-steps">
            <For each={steps}>{(s, i) => <span classList={{ on: i() <= step() }}>{s}</span>}</For>
          </div>

          <Switch>
            <Match when={step() === 0}>
              <div class="ob-hero">
                <div class="ob-logo">T</div>
                <h1>Добро пожаловать в Tulpar</h1>
                <p>Быстрый редактор кода с ИИ-агентом, без слежки и лишней нагрузки на компьютер. Настроим его под вас за минуту.</p>
                <div class="ob-lang" data-no-translate>
                  <button classList={{ on: currentLang() === "ru" }} onClick={() => void updateSetting("workbench.language", "ru")}>
                    Русский
                  </button>
                  <button classList={{ on: currentLang() === "en" }} onClick={() => void updateSetting("workbench.language", "en")}>
                    English
                  </button>
                </div>
              </div>
            </Match>

            <Match when={step() === 1}>
              <h2>Какой дизайн вам ближе?</h2>
              <p class="ob-sub">Можно поменять в любой момент: Настройки → Внешний вид.</p>
              <div class="ob-grid two">
                <DesignCard value="classic" title="Дизайн 1" text="Полоса иконок слева, панели-острова. Привычно, если пришли из VS Code." />
                <DesignCard value="tulpar" title="Дизайн 2 — Tulpar" text="Верхняя панель с ИИ-островом, боковая панель выезжает при наведении. Больше места для кода." />
              </div>
            </Match>

            <Match when={step() === 2}>
              <h2>Выберите тему</h2>
              <p class="ob-sub">А ещё можно перетащить в окно любую картинку — и Tulpar перекрасится под её цвета.</p>
              <div class="ob-grid three">
                <For each={THEME_NAMES.filter(([id]) => id !== "photo")}>{([id, title]) => <ThemeCard id={id} title={title} />}</For>
              </div>
            </Match>

            <Match when={step() === 3}>
              <h2>Подключим ИИ?</h2>
              <p class="ob-sub">ИИ пишет код, исправляет ошибки и выполняет задачи в проекте. Всё работает и без него.</p>
              <div class="ob-grid two">
                <button class="ob-card ob-ai" classList={{ active: ai() === "cloud" }} onClick={() => setAi("cloud")}>
                  <b>☁ Слабый компьютер или ноутбук</b>
                  <small>Модель работает в облаке, компьютер не нагружается. Бесплатно.</small>
                  <Show when={weakPc()}><em>Подходит для вашего компьютера</em></Show>
                </button>
                <button class="ob-card ob-ai" classList={{ active: ai() === "local" }} onClick={() => setAi("local")}>
                  <b>💻 Мощный компьютер</b>
                  <small>Модель на вашем компьютере: бесплатно, без интернета, код никуда не уходит.</small>
                  <Show when={!weakPc() && memory().ramGb !== null}><em>Подходит для вашего компьютера</em></Show>
                </button>
                <button class="ob-card ob-ai" classList={{ active: ai() === "key" }} onClick={() => setAi("key")}>
                  <b>🔑 У меня есть ключ API</b>
                  <small>Claude, OpenAI, OpenCode Zen, OpenRouter — самые умные модели.</small>
                </button>
                <button class="ob-card ob-ai" classList={{ active: ai() === "none" }} onClick={() => setAi("none")}>
                  <b>Пока без ИИ</b>
                  <small>Подключить можно позже в настройках.</small>
                </button>
              </div>

              <Switch>
                <Match when={ai() === "cloud"}>
                  <div class="ob-detail">
                    <p>
                      Самый простой бесплатный вариант — <b>OpenCode</b>: агент с бесплатными облачными моделями, Tulpar запустит его в
                      терминале. Второй вариант — облачные модели <b>Ollama</b> (нужна Ollama и вход в аккаунт).
                    </p>
                    <div class="ob-actions-inline">
                      <button class="button" onClick={() => void runInTerminal("npm install -g @opencode/cli", "Установка OpenCode")}>
                        Установить OpenCode
                      </button>
                      <button
                        class="button-quiet"
                        disabled={!running()}
                        title={running() ? "" : "Сначала установите Ollama (Настройки → Локальный ИИ)"}
                        onClick={() => {
                          void runInTerminal("ollama signin", "Ollama");
                          useModel("gpt-oss:20b-cloud");
                        }}
                      >
                        Ollama: войти и выбрать gpt-oss:20b-cloud
                      </button>
                    </div>
                  </div>
                </Match>
                <Match when={ai() === "local"}>
                  <div class="ob-detail">
                    <Show
                      when={running()}
                      fallback={
                        <p>
                          Нужна бесплатная программа Ollama. Установите её командой <code>winget install Ollama.Ollama</code> в терминале
                          (Ctrl+`), затем откройте Настройки → Локальный ИИ.
                        </p>
                      }
                    >
                      <p>
                        Для вашего компьютера подойдёт <b>{localPick().title}</b> ({localPick().sizeGb} ГБ). {localPick().note}
                      </p>
                      <div class="ob-actions-inline">
                        <Show
                          when={!isInstalled(localPick().tag)}
                          fallback={<button class="button" onClick={() => useModel(localPick().tag)}>Использовать {localPick().tag}</button>}
                        >
                          <button class="button" disabled={!!progress()[localPick().tag]} onClick={() => void install(localPick().tag)}>
                            {progress()[localPick().tag]
                              ? `Скачиваю… ${progress()[localPick().tag]!.fraction !== null ? Math.round(progress()[localPick().tag]!.fraction! * 100) + "%" : ""}`
                              : `Установить ${localPick().tag}`}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </Match>
                <Match when={ai() === "key"}>
                  <div class="ob-detail">
                    <p>Откроем настройки ИИ: выберите сервис, вставьте ключ и нажмите «Выбрать модель…».</p>
                    <div class="ob-actions-inline">
                      <button
                        class="button"
                        onClick={() => {
                          finish();
                          setSettingsVisible(true);
                        }}
                      >
                        Открыть настройки ИИ
                      </button>
                    </div>
                  </div>
                </Match>
              </Switch>
            </Match>

            <Match when={step() === 4}>
              <div class="ob-hero">
                <div class="ob-logo">✓</div>
                <h1>Всё готово</h1>
                <p>Несколько клавиш, которые пригодятся:</p>
                <div class="ob-keys">
                  <span><kbd>Ctrl+K Ctrl+O</kbd> открыть папку</span>
                  <span><kbd>Ctrl+P</kbd> найти файл</span>
                  <span><kbd>Ctrl+Shift+P</kbd> все команды</span>
                  <span><kbd>Ctrl+`</kbd> терминал</span>
                  <span><kbd>Ctrl+Alt+I</kbd> чат с ИИ</span>
                  <span><kbd>Ctrl+F5</kbd> запустить файл</span>
                </div>
              </div>
            </Match>
          </Switch>

          <div class="ob-footer">
            <button class="button-quiet" onClick={finish}>
              {step() === 4 ? "" : "Пропустить"}
            </button>
            <div class="ob-nav">
              <Show when={step() > 0 && step() < 4}>
                <button class="button-quiet" onClick={() => setStep(step() - 1)}>Назад</button>
              </Show>
              <Show
                when={step() < 4}
                fallback={
                  <>
                    <button class="button-quiet" onClick={finish}>Закрыть</button>
                    <button
                      class="button"
                      onClick={() => {
                        finish();
                        void executeCommand("workbench.action.files.openFolder");
                      }}
                    >
                      Открыть папку проекта
                    </button>
                  </>
                }
              >
                <button class="button" onClick={() => setStep(step() + 1)}>
                  {step() === 0 ? "Начать" : "Дальше"}
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
