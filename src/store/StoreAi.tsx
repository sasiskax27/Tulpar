// Вкладка «ИИ» в магазине: облачные сервисы карточками и лучшие лёгкие
// локальные модели, которые ставятся одной кнопкой через Ollama.
import { For, onMount, Show } from "solid-js";
import AiServices from "../settings/AiServices";
import { catalog } from "../ai/models";
import { fitOf, initLocalAi, install, isCurrent, isInstalled, progress, running, useModel } from "../ai/ollama";
import { core } from "../ipc";

/** Лучшие модели по размеру: от совсем слабых ПК до игровых. */
const PICKS: { tag: string; why: string }[] = [
  { tag: "qwen2.5-coder:1.5b", why: "Для самых слабых ПК и подсказок при наборе" },
  { tag: "qwen3.5:4b", why: "Лучший баланс для 6–8 ГБ: быстрая и неглупая" },
  { tag: "qwen2.5-coder:7b", why: "Проверенная модель для кода на 8 ГБ видеопамяти" },
  { tag: "qwen3.5:9b", why: "Заметно умнее, если памяти хватает" },
  { tag: "gemma4:12b", why: "Модель Google для 12–16 ГБ" },
  { tag: "gpt-oss:20b", why: "Одна из лучших на 16 ГБ видеопамяти" },
];

const FIT: Record<string, string> = { fast: "🟢 пойдёт быстро", slow: "🟡 пойдёт медленно", no: "🔴 не хватит памяти", unknown: "" };

export default function StoreAi() {
  onMount(() => void initLocalAi());
  const models = () => PICKS.map((p) => ({ ...p, m: catalog.find((c) => c.tag === p.tag) })).filter((p) => p.m);
  return (
    <div class="store-ai">
      <h3 class="store-h">☁ Облачные ИИ — компьютер не нагружается</h3>
      <AiServices compact />
      <h3 class="store-h">💻 Лёгкие модели на компьютер — бесплатно и без интернета</h3>
      <Show when={running() === false}>
        <div class="tool-row">
          <span class="dim small">Для локальных моделей нужна Ollama.</span>
          <button class="primary" onClick={() => void core.openUrl("https://ollama.com/download")}>Скачать Ollama</button>
        </div>
      </Show>
      <div class="store-grid">
        <For each={models()}>
          {(p) => {
            const prog = () => progress()[p.tag];
            return (
              <div class="store-card" classList={{ on: isInstalled(p.tag) }}>
                <div class="store-top">
                  <span class="store-icon">🧠</span>
                  <div class="store-name">
                    <b data-no-translate>{p.m!.title}</b>
                    <span class="dim small">{p.m!.sizeGb} ГБ · {FIT[fitOf(p.m!)]}</span>
                  </div>
                  <Show when={isCurrent(p.tag)}><span class="store-live">● в работе</span></Show>
                </div>
                <div class="small store-desc">{p.why}</div>
                <Show when={prog()}>
                  {(g) => <div class="review-progress"><div class="fill" style={{ width: `${(g().fraction ?? 0.1) * 100}%` }} /><span>{g().status}</span></div>}
                </Show>
                <div class="tool-row">
                  <Show when={isInstalled(p.tag)} fallback={<button class="primary" disabled={!!prog() || running() === false} onClick={() => void install(p.tag)}>{prog() ? "Скачиваю…" : "Установить"}</button>}>
                    <Show when={!isCurrent(p.tag)}><button class="primary" onClick={() => useModel(p.tag)}>Использовать</button></Show>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
      <div class="dim small">Совет: в настройках ИИ выключите «Модель думает перед ответом» — Qwen 3.5 и DeepSeek R1 начнут отвечать в разы быстрее.</div>
    </div>
  );
}
