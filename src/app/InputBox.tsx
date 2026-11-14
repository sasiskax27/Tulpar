// Строка ввода поверх окна — когда команде нужен текст от пользователя.
// Использование: const text = await askInput("Что сделать с кодом?");
import { createSignal, Show } from "solid-js";

interface Request {
  placeholder: string;
  /** Подпись над полем (что спрашиваем) */
  title?: string;
  value?: string;
  resolve: (value: string | null) => void;
}

const [request, setRequest] = createSignal<Request | null>(null);
let restoreFocus: HTMLElement | null = null;

/** Спросить строку. null — пользователь нажал Escape или ничего не ввёл.
 *  Можно передать строку-подсказку или { title, placeholder, value }. */
export function askInput(opts: string | { title?: string; placeholder?: string; value?: string }): Promise<string | null> {
  request()?.resolve(null);
  restoreFocus = document.activeElement as HTMLElement | null;
  const o = typeof opts === "string" ? { placeholder: opts } : opts;
  return new Promise((resolve) => setRequest({ placeholder: o.placeholder ?? "", title: o.title, value: o.value, resolve }));
}

function finish(value: string | null) {
  const r = request();
  setRequest(null);
  restoreFocus?.focus();
  r?.resolve(value && value.trim() ? value.trim() : null);
}

export default function InputBox() {
  return (
    <Show when={request()}>
      {(r) => (
        <div class="palette-backdrop" onMouseDown={() => finish(null)}>
          <div class="palette" onMouseDown={(e) => e.stopPropagation()}>
            <Show when={r().title}>
              <div class="input-title">{r().title}</div>
            </Show>
            <input
              ref={(el) => queueMicrotask(() => {
                el.focus();
                el.select();
              })}
              value={r().value ?? ""}
              class="palette-input"
              placeholder={r().placeholder}
              spellcheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finish(e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  finish(null);
                }
              }}
            />
            <div class="palette-empty">Enter — выполнить, Esc — отмена</div>
          </div>
        </div>
      )}
    </Show>
  );
}
