// Раздел «Структура»: функции, классы и методы открытого файла деревом.
import { createSignal, For, Show } from "solid-js";
import { currentPath, refreshOutline, revealSymbol, symbols } from "./outline";
import { KIND, type Sym } from "./symbols";
import { activePath } from "./tabs";
import { baseName } from "../ipc";

function Node(props: { sym: Sym; depth: number; filter: string }) {
  const [open, setOpen] = createSignal(true);
  const k = () => KIND[props.sym.kind] ?? ["•", "#8B8B8B"];
  const active = () => currentPath().includes(props.sym);
  const matches = (s: Sym): boolean => !props.filter || s.name.toLowerCase().includes(props.filter) || s.children.some(matches);
  return (
    <Show when={matches(props.sym)}>
      <div
        class="outline-item"
        classList={{ active: active() }}
        style={{ "padding-left": `${8 + props.depth * 14}px` }}
        onClick={() => revealSymbol(props.sym)}
        title={`${props.sym.name} — строка ${props.sym.line}`}
      >
        <span class="twistie" onClick={(e) => { e.stopPropagation(); setOpen(!open()); }}>
          {props.sym.children.length ? (open() ? "▾" : "▸") : ""}
        </span>
        <span class="outline-kind" style={{ color: k()[1] }}>{k()[0]}</span>
        <span class="outline-name">{props.sym.name}</span>
        <Show when={props.sym.detail}>
          <span class="outline-detail">{props.sym.detail}</span>
        </Show>
      </div>
      <Show when={open()}>
        <For each={props.sym.children}>{(c) => <Node sym={c} depth={props.depth + 1} filter={props.filter} />}</For>
      </Show>
    </Show>
  );
}

export default function OutlinePanel() {
  const [filter, setFilter] = createSignal("");
  return (
    <div class="outline-panel">
      <div class="panel-header">
        <span>Структура{activePath() ? ` · ${baseName(activePath()!)}` : ""}</span>
        <div class="panel-actions">
          <button class="icon-button" title="Обновить" aria-label="Обновить" onClick={() => void refreshOutline()}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" /></svg>
          </button>
        </div>
      </div>
      <input class="settings-input outline-filter" placeholder="Найти функцию или класс…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value.toLowerCase())} />
      <div class="outline-list">
        <Show
          when={symbols().length}
          fallback={
            <p class="outline-empty">
              {activePath()
                ? "Здесь появятся функции и классы файла. Нужен языковой сервер для этого языка (для JS/TS работает сразу)."
                : "Откройте файл"}
            </p>
          }
        >
          <For each={symbols()}>{(s) => <Node sym={s} depth={0} filter={filter()} />}</For>
        </Show>
      </div>
    </div>
  );
}
