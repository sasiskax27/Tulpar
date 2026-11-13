// Палитра команд (Ctrl+Shift+P) и быстрый переход к файлу (Ctrl+P) — одно окно,
// как в VS Code: строка, начинающаяся с «>», ищет команды, иначе — файлы.
import { createMemo, createSignal, For, Show } from "solid-js";
import { allCommands, executeCommand, label } from "../commands/registry";
import { keybindingFor } from "../keybindings/keybindings";
import { core, joinPath } from "../ipc";
import { root } from "../app/workspace";
import { openFile } from "../editor/tabs";

const [visible, setVisible] = createSignal(false);
const [query, setQuery] = createSignal("");
const [files, setFiles] = createSignal<string[]>([]);
const [selected, setSelected] = createSignal(0);

let input: HTMLInputElement | undefined;
let restoreFocus: HTMLElement | null = null;

export function showPalette(initial: "" | ">") {
  restoreFocus = document.activeElement as HTMLElement | null;
  setQuery(initial);
  setSelected(0);
  setVisible(true);
  if (initial === "" && root()) {
    core.listFiles().then(setFiles).catch(() => setFiles([]));
  }
  queueMicrotask(() => input?.focus());
}

function hide() {
  setVisible(false);
  restoreFocus?.focus();
}

/** Нечёткий поиск: все буквы запроса по порядку. Чем плотнее совпадение и чем ближе
 *  к имени файла, тем выше оценка. null — не подходит. */
function score(text: string, q: string): number | null {
  if (!q) return 0;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  let ti = 0;
  let total = 0;
  let last = -1;
  for (const ch of s) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    total += found === last + 1 ? 3 : 1;
    if (found === 0 || "/\\-_. ".includes(t[found - 1])) total += 2;
    last = found;
    ti = found + 1;
  }
  const nameStart = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1;
  if (t.indexOf(s[0], nameStart) !== -1) total += 4;
  return total - text.length * 0.01;
}

interface Item {
  label: string;
  detail?: string;
  run: () => void;
}

const items = createMemo<Item[]>(() => {
  const q = query();
  if (q.startsWith(">")) {
    const text = q.slice(1).trim();
    return allCommands()
      .flatMap((c) => {
        const s = score(label(c), text);
        return s === null ? [] : [{ c, s }];
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, 100)
      .map(({ c }) => ({
        label: label(c),
        detail: keybindingFor(c.id),
        run: () => void executeCommand(c.id),
      }));
  }
  const r = root();
  if (!r) return [];
  return files()
    .flatMap((f) => {
      const s = score(f, q.trim());
      return s === null ? [] : [{ f, s }];
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, 50)
    .map(({ f }) => {
      const slash = f.lastIndexOf("/");
      return {
        label: f.slice(slash + 1),
        detail: slash > 0 ? f.slice(0, slash) : undefined,
        run: () => void openFile(joinPath(r, f)),
      };
    });
});

function onKey(e: KeyboardEvent) {
  const list = items();
  if (e.key === "Escape") {
    e.preventDefault();
    hide();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    setSelected((i) => Math.min(i + 1, list.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setSelected((i) => Math.max(i - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const item = list[selected()];
    hide();
    item?.run();
  }
}

export default function Palette() {
  return (
    <Show when={visible()}>
      <div class="palette-backdrop" onMouseDown={hide}>
        <div class="palette" onMouseDown={(e) => e.stopPropagation()}>
          <input
            ref={input}
            class="palette-input"
            value={query()}
            placeholder={query().startsWith(">") ? "Введите команду" : "Поиск файла по имени (> — команды)"}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelected(0);
            }}
            onKeyDown={onKey}
            spellcheck={false}
          />
          <div class="palette-list">
            <For each={items()}>
              {(item, i) => (
                <div
                  class="palette-item"
                  classList={{ selected: i() === selected() }}
                  onMouseMove={() => setSelected(i())}
                  onClick={() => {
                    hide();
                    item.run();
                  }}
                >
                  <span class="palette-label">{item.label}</span>
                  <Show when={item.detail}>
                    <span class="palette-detail">{item.detail}</span>
                  </Show>
                </div>
              )}
            </For>
            <Show when={items().length === 0}>
              <div class="palette-empty">
                {!query().startsWith(">") && !root() ? "Сначала откройте папку" : "Ничего не найдено"}
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
