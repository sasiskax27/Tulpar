// Раздел настроек «Локальный ИИ»: установка моделей Ollama одной кнопкой.
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js";
import { catalog, cloudCatalog, type CatalogModel } from "../ai/models";
import { runInTerminal } from "../terminal/sessions";
import {
  fitOf, initLocalAi, install, installed, isCurrent, isInstalled, memory,
  normalize, progress, refresh, remove, running, useModel, type Fit,
} from "../ai/ollama";

const isWindows = navigator.userAgent.includes("Windows");
const isMac = navigator.userAgent.includes("Mac");
const installCommand = isWindows
  ? "winget install Ollama.Ollama"
  : isMac
    ? "brew install --cask ollama"
    : "curl -fsSL https://ollama.com/install.sh | sh";

const fitLabel: Record<Fit, string> = {
  fast: "быстро, на видеокарте",
  slow: "медленно, на процессоре",
  no: "не хватит памяти",
  unknown: "",
};

const gb = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)} ГБ`;

function Actions(props: { tag: string }) {
  const p = () => progress()[props.tag];
  return (
    <div class="model-actions">
      <Switch>
        <Match when={p()}>
          <span class="model-progress">
            {p()!.fraction === null ? p()!.status : `${Math.round(p()!.fraction! * 100)}%`}
          </span>
        </Match>
        <Match when={!isInstalled(props.tag)}>
          <button class="button" disabled={!running()} onClick={() => void install(props.tag)}>
            Установить
          </button>
        </Match>
        <Match when={isCurrent(props.tag)}>
          <span class="model-current">Выбрана</span>
          <button class="button-quiet" onClick={() => void remove(props.tag)}>
            Удалить
          </button>
        </Match>
        <Match when={true}>
          <button class="button" onClick={() => useModel(props.tag)}>
            Использовать
          </button>
          <button class="button-quiet" onClick={() => void remove(props.tag)}>
            Удалить
          </button>
        </Match>
      </Switch>
    </div>
  );
}

export default function LocalAi() {
  const [custom, setCustom] = createSignal("");
  onMount(() => void initLocalAi());

  // Лучшая модель для этого компьютера: самая большая из тех, что работают быстро
  const recommended = createMemo(() => {
    const fast = catalog.filter((m) => fitOf(m) === "fast");
    const pool = fast.length ? fast : catalog.filter((m) => fitOf(m) === "slow" && m.sizeGb <= 5);
    return pool.reduce<CatalogModel | undefined>((best, m) => (!best || m.sizeGb > best.sizeGb ? m : best), undefined)?.tag;
  });

  // Установленные модели, которых нет в каталоге
  const extra = () =>
    installed().filter(
      (m) => !catalog.some((c) => normalize(c.tag) === normalize(m.name)) && !cloudCatalog.some((c) => normalize(c.tag) === normalize(m.name)),
    );

  const addCustom = () => {
    const tag = custom().trim();
    if (!tag) return;
    setCustom("");
    void install(tag);
  };

  return (
    <div class="local-ai">
      <Switch>
        <Match when={running() === null}>
          <p class="settings-intro">Проверяю, запущена ли Ollama…</p>
        </Match>
        <Match when={running() === false}>
          <div class="local-ai-setup">
            <p>
              Ollama не найдена. Это бесплатная программа, которая запускает модели ИИ на вашем компьютере. Установите
              её этой командой в терминале (Ctrl+`), затем нажмите «Проверить снова».
            </p>
            <div class="local-ai-command">
              <code>{installCommand}</code>
              <button class="button-quiet" onClick={() => void navigator.clipboard.writeText(installCommand)}>
                Копировать
              </button>
              <button class="button" onClick={() => void refresh()}>
                Проверить снова
              </button>
            </div>
          </div>
        </Match>
        <Match when={true}>
          <p class="settings-intro">
            Ollama запущена, моделей установлено: {installed().length}.
            <Show when={memory().ramGb !== null}>
              {" "}
              Память компьютера: {gb(memory().ramGb!)}
              {memory().vramGb !== null ? `, видеокарта: ${gb(memory().vramGb!)}` : ", видеокарта NVIDIA не найдена"}.
            </Show>
          </p>
        </Match>
      </Switch>

      <h3 class="local-ai-heading">Облачные модели Ollama — для слабых компьютеров</h3>
      <p class="settings-intro">
        Модели с пометкой «облако» считаются на серверах Ollama: компьютер не нагружается, но нужен интернет и вход в
        аккаунт ollama.com. Бесплатно с лимитом (сбрасывается каждые 5 часов и раз в неделю). Код при этом уходит на
        серверы Ollama.
      </p>
      <div class="model-row">
        <div class="model-info">
          <span class="model-title">Вход в Ollama</span>
          <small>Один раз: команда откроет страницу входа в браузере. После входа нажмите «Установить» у облачной модели.</small>
        </div>
        <div class="model-actions">
          <button class="button" disabled={!running()} onClick={() => void runInTerminal("ollama signin", "Ollama")}>
            Войти (ollama signin)
          </button>
        </div>
      </div>
      <For each={cloudCatalog}>
        {(m) => (
          <div class="model-row">
            <div class="model-info">
              <span class="model-title">
                {m.title}
                <span class="model-badge cloud">облако</span>
              </span>
              <small>{m.tag} · почти не занимает места</small>
              <small>{m.note}</small>
            </div>
            <Actions tag={m.tag} />
          </div>
        )}
      </For>

      <h3 class="local-ai-heading">Модели на вашем компьютере</h3>
      <For each={extra()}>
        {(m) => (
          <div class="model-row">
            <div class="model-info">
              <span class="model-title">{m.name}</span>
              <small>{gb(m.size / 1024 ** 3)} · установлена вручную</small>
            </div>
            <Actions tag={m.name} />
          </div>
        )}
      </For>

      <For each={catalog}>
        {(m) => (
          <div class="model-row" classList={{ dim: fitOf(m) === "no" && !isInstalled(m.tag) }}>
            <div class="model-info">
              <span class="model-title">
                {m.title}
                <Show when={recommended() === m.tag}>
                  <span class="model-badge">для вашего компьютера</span>
                </Show>
              </span>
              <small>
                {gb(m.sizeGb)} · {m.kind}
                <Show when={fitOf(m) !== "unknown"}> · {fitLabel[fitOf(m)]}</Show>
              </small>
              <small>{m.note}</small>
            </div>
            <Actions tag={m.tag} />
          </div>
        )}
      </For>

      <div class="model-row">
        <div class="model-info">
          <span class="model-title">Другая модель</span>
          <small>Любое название с ollama.com/library, например mistral:7b</small>
        </div>
        <div class="model-actions">
          <input
            class="settings-input"
            placeholder="название:размер"
            spellcheck={false}
            value={custom()}
            onInput={(e) => setCustom(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustom()}
          />
          <button class="button" disabled={!running()} onClick={addCustom}>
            Установить
          </button>
        </div>
      </div>
    </div>
  );
}
