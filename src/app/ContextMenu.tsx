// Контекстное меню (правый клик). Одно на всё приложение:
// showContextMenu(event, [{ label, run }, "-", …]).
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

export interface MenuItem {
  label: string;
  run: () => void;
  shortcut?: string;
  danger?: boolean;
}

type Entry = MenuItem | "-";

interface MenuState {
  x: number;
  y: number;
  items: Entry[];
}

const [menu, setMenu] = createSignal<MenuState | null>(null);

export function showContextMenu(e: MouseEvent, items: Entry[]) {
  e.preventDefault();
  e.stopPropagation();
  setMenu({ x: e.clientX, y: e.clientY, items });
}

/** Показать меню в точке окна — когда нет события мыши (например, после перетаскивания). */
export function showContextMenuAt(x: number, y: number, items: Entry[]) {
  setMenu({ x, y, items });
}

export function hideContextMenu() {
  setMenu(null);
}

function Menu(props: { state: MenuState }) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ x: props.state.x, y: props.state.y });

  onMount(() => {
    // Не даём меню вылезти за край окна
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(props.state.x, window.innerWidth - r.width - 6),
      y: Math.min(props.state.y, window.innerHeight - r.height - 6),
    });
    el.querySelector<HTMLButtonElement>("button")?.focus();
    const close = () => hideContextMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [...el.querySelectorAll<HTMLButtonElement>("button")];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    });
  });

  return (
    <div class="context-backdrop" onMouseDown={hideContextMenu} onContextMenu={(e) => { e.preventDefault(); hideContextMenu(); }}>
      <div
        ref={el}
        class="context-menu"
        role="menu"
        style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <For each={props.state.items}>
          {(item) =>
            item === "-" ? (
              <div class="context-sep" role="separator" />
            ) : (
              <button
                class="context-item"
                classList={{ danger: !!item.danger }}
                role="menuitem"
                onClick={() => {
                  hideContextMenu();
                  item.run();
                }}
              >
                <span>{item.label}</span>
                <Show when={item.shortcut}>
                  <kbd>{item.shortcut}</kbd>
                </Show>
              </button>
            )
          }
        </For>
      </div>
    </div>
  );
}

export default function ContextMenu() {
  return <Show when={menu()} keyed>{(state) => <Menu state={state} />}</Show>;
}
