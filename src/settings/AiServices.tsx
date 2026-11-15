// Выбор ИИ-сервиса карточками: бесплатные сверху, вход в браузере, проверка связи.
import { For, Show } from "solid-js";
import { settings } from "../config/store";
import { core } from "../ipc";
import { login, loginBusy, serviceById, services, switchService, testConnection } from "../ai/services";

export default function AiServices(props: { compact?: boolean }) {
  const current = () => String(settings()["tulpar.ai.provider"]);
  const svc = () => serviceById(current());
  return (
    <div class="ai-services">
      <div class="ai-service-grid" classList={{ compact: !!props.compact }}>
        <For each={services}>
          {(s) => (
            <button class="ai-service" classList={{ on: current() === s.id }} onClick={() => switchService(s.id)} title={s.note}>
              <span class="ai-service-icon">{s.icon}</span>
              <span class="ai-service-name" data-no-translate>{s.name}</span>
              <span class="ai-service-tags">
                <For each={s.tags}>{(t) => <span class="ai-tag" classList={{ free: /бесплат|компьютер/.test(t), fast: /быстр/.test(t) }}>{t}</span>}</For>
              </span>
            </button>
          )}
        </For>
      </div>
      <Show when={svc()}>
        {(s) => (
          <div class="ai-service-panel">
            <div class="ai-service-note">{s().note}</div>
            <div class="settings-buttons wrap">
              <Show when={s().login}>
                {(kind) => (
                  <button class="primary" disabled={!!loginBusy()} onClick={() => void login(kind())}>
                    {loginBusy() === kind() ? "Ждём вход в браузере…" : kind() === "ollama" ? "Войти в облако Ollama" : `Войти через ${s().name}`}
                  </button>
                )}
              </Show>
              <Show when={s().keyUrl}>
                {(url) => (
                  <button class="button" onClick={() => void core.openUrl(url())}>
                    🔑 Получить ключ
                  </button>
                )}
              </Show>
              <button class="button" disabled={!!loginBusy()} onClick={() => void testConnection()}>
                {loginBusy() === "test" ? "Проверяем…" : "Проверить связь"}
              </button>
            </div>
            <Show when={s().needsKey && !settings()["tulpar.ai.apiKey"] && !s().login}>
              <div class="ai-service-warn">Нажмите «Получить ключ», создайте ключ на сайте и вставьте его в поле «Ключ API» ниже.</div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
