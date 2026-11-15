// Выбор ИИ-сервиса карточками: бесплатные сверху, вход в браузере, проверка связи.
import { For, Show } from "solid-js";
import { settings, updateSetting } from "../config/store";
import { core } from "../ipc";
import { providers } from "../ai/ai";
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
            <ol class="ai-steps">
              <For each={s().steps}>{(step) => <li>{step}</li>}</For>
            </ol>
            <Show when={s().needsKey}>
              <label class="ai-field">
                <span>Ключ API</span>
                <input
                  class="settings-input"
                  type="password"
                  placeholder="вставьте ключ сюда"
                  value={String(settings()["tulpar.ai.apiKey"] ?? "")}
                  onChange={(e) => updateSetting("tulpar.ai.apiKey", e.currentTarget.value.trim())}
                />
              </label>
            </Show>
            <Show when={s().models.length}>
              <div class="ai-field">
                <span>Модель</span>
                <div class="ai-models">
                  <For each={s().models}>
                    {(m) => (
                      <button
                        class="ai-model"
                        classList={{ on: (settings()["tulpar.ai.model"] || providers[s().id]?.model) === m.id }}
                        onClick={() => updateSetting("tulpar.ai.model", m.id)}
                        title={m.id}
                      >
                        <b data-no-translate>{m.id}</b>
                        <small>{m.note}</small>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <label class="ai-field">
              <span>Своя модель</span>
              <input
                class="settings-input"
                placeholder={providers[s().id]?.model || "название модели"}
                value={String(settings()["tulpar.ai.model"] ?? "")}
                onChange={(e) => updateSetting("tulpar.ai.model", e.currentTarget.value.trim())}
              />
            </label>
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
            <Show when={s().needsKey && !settings()["tulpar.ai.apiKey"]}>
              <div class="ai-service-warn">Ключа пока нет — сделайте шаги выше, иначе ИИ не ответит.</div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
