// Выбор из списка с поиском — для веток и других коротких списков.
// const value = await pick([{ label: "main", value: "main" }], "Ветка");
import { createMemo, createSignal, For, Show } from "solid-js";

export interface PickItem<T> {
  label: string;
  detail?: string;
  value: T;
}

interface Request {
  items: PickItem<unknown>[];
  placeholder: string;
  resolve: (value: unknown) => void;
}

const [request, setRequest] = createSignal<Request | null>(null);
let restoreFocus: HTMLElement | null = null;

export function pick<T>(items: PickItem<T>[], placeholder: string): Promise<T | null> {
  request()?.resolve(null);
  restoreFocus = document.activeElement as HTMLElement | null;
  return new Promise((resolve) =>
    setRequest({ items: items as PickItem<unknown>[], placeholder, resolve: resolve as (v: unknown) => void }),
  );
}

function finish(value: unknown) {
  const r = request();
  setRequest(null);
  restoreFocus?.focus();
  r?.resolve(value);
}

function Picker(props: { req: Request }) {
  const [filter, setFilter] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const shown = createMemo(() => {
    const f = filter().toLowerCase();
    return props.req.items.filter((i) => i.label.toLowerCase().includes(f) || (i.detail ?? "").toLowerCase().includes(f));
  });
  return (
    <div class="palette-backdrop" onMouseDown={() => finish(null)}>
      <div class="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={(el) => queueMicrotask(() => el.focus())}
          class="palette-input"
          placeholder={props.req.placeholder}
          spellcheck={false}
          value={filter()}
          onInput={(e) => {
            setFilter(e.currentTarget.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              finish(null);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, shown().length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = shown()[selected()];
              if (item) finish(item.value);
            }
          }}
        />
        <div class="palette-list">
          <For each={shown()}>
            {(item, i) => (
              <div
                class="palette-item"
                classList={{ selected: i() === selected() }}
                onMouseMove={() => setSelected(i())}
                onClick={() => finish(item.value)}
              >
                <span class="palette-label">{item.label}</span>
                <Show when={item.detail}>
                  <span class="palette-detail">{item.detail}</span>
                </Show>
              </div>
            )}
          </For>
          <Show when={shown().length === 0}>
            <div class="palette-empty">Ничего не найдено</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default function QuickPick() {
  return <Show when={request()} keyed>{(r) => <Picker req={r} />}</Show>;
}
