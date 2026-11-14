// Свои действия ИИ: название и инструкция → новый пункт «ИИ: …» в меню по правому клику.
import { For, Show } from "solid-js";
import { settings, updateSetting, type CustomAiAction } from "../config/store";

const EXAMPLES: CustomAiAction[] = [
  { name: "Перевести комментарии на английский", prompt: "Translate all comments in this code to English. Do not change the code itself.", mode: "replace" },
  { name: "Добавить обработку ошибок", prompt: "Add sensible error handling to this code, in the idiomatic style of its language. Keep the behavior otherwise unchanged.", mode: "replace" },
  { name: "Оценить сложность", prompt: "Estimate the time and memory complexity of this code and briefly explain why.", mode: "show" },
];

export default function CustomActions() {
  const list = () => (Array.isArray(settings()["tulpar.ai.customActions"]) ? settings()["tulpar.ai.customActions"] : []);
  const save = (next: CustomAiAction[]) => updateSetting("tulpar.ai.customActions", next);
  const change = (i: number, patch: Partial<CustomAiAction>) => save(list().map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const remove = (i: number) => save(list().filter((_, j) => j !== i));

  return (
    <div class="custom-actions">
      <For each={list()}>
        {(action, i) => (
          <div class="custom-action">
            <div class="custom-action-row">
              <input
                class="settings-input"
                placeholder="Название, например «Сделать async»"
                aria-label="Название действия"
                value={action.name}
                onChange={(e) => change(i(), { name: e.currentTarget.value })}
              />
              <select
                class="settings-input custom-action-mode"
                aria-label="Что делать с ответом"
                onChange={(e) => change(i(), { mode: e.currentTarget.value as CustomAiAction["mode"] })}
              >
                <option value="replace" selected={action.mode !== "show"}>Заменить код</option>
                <option value="show" selected={action.mode === "show"}>Показать ответ</option>
              </select>
              <button class="button-quiet" aria-label="Удалить действие" title="Удалить" onClick={() => remove(i())}>
                ×
              </button>
            </div>
            <textarea
              class="settings-input custom-action-prompt"
              rows={2}
              placeholder="Что должен сделать ИИ с выделенным кодом"
              aria-label="Инструкция для ИИ"
              value={action.prompt}
              onChange={(e) => change(i(), { prompt: e.currentTarget.value })}
            />
          </div>
        )}
      </For>
      <div class="custom-action-buttons">
        <button class="button" onClick={() => save([...list(), { name: "", prompt: "", mode: "replace" }])}>
          + Добавить действие
        </button>
        <Show when={list().length === 0}>
          <button class="button-quiet" onClick={() => save(EXAMPLES)}>
            Добавить примеры
          </button>
        </Show>
      </div>
    </div>
  );
}
