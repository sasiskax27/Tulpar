// ⏳ Машина времени: ползунок по сохранённым версиям текущего файла.
import { createEffect, createMemo, createResource, createSignal, For, on, Show } from "solid-js";
import { activePath, modelFor, openDiff } from "../editor/tabs";
import { baseName } from "../ipc";
import { notify } from "../app/notify";
import { addSnapshot, ago, clearHistory, historyVersion, lineDelta, snapshots, type Snapshot } from "./history";

export default function HistoryView() {
  const [path, setPath] = createSignal<string | null>(null);
  createEffect(() => {
    const p = activePath();
    if (p && !p.startsWith("diff:")) setPath(p);
  });
  const [list] = createResource(
    () => [path(), historyVersion()] as const,
    async ([p]) => (p ? snapshots(p) : []),
  );
  const [pos, setPos] = createSignal(0);
  createEffect(on(path, () => setPos(0)));

  const items = () => list() ?? [];
  const current = createMemo<Snapshot | undefined>(() => items()[pos()]);
  const delta = (i: number) => {
    const s = items()[i];
    const prev = items()[i + 1];
    return s && prev ? lineDelta(prev.content, s.content) : null;
  };

  const compare = async () => {
    const s = current();
    const p = path();
    if (!s || !p) return;
    await openDiff(p, s.content, `${baseName(p)} ⟷ ${ago(s.time)}`);
  };

  const restore = async () => {
    const s = current();
    const p = path();
    const model = p ? modelFor(p) : undefined;
    if (!s || !p || !model) return;
    await addSnapshot(p, model.getValue(), "restore");
    model.pushStackElement();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: s.content }], () => null);
    model.pushStackElement();
    notify("Версия восстановлена. Сохраните файл или отмените — Ctrl+Z");
    void import("../hype/achievements").then((a) => a.unlock("time-traveler"));
  };

  const REASON: Record<Snapshot["reason"], string> = { save: "сохранение", restore: "до восстановления", ai: "до правки ИИ" };

  return (
    <div class="tool history">
      <Show when={path()} fallback={<div class="tool-empty">Откройте файл — здесь появятся его прошлые версии.</div>}>
        <div class="tool-row">
          <b data-no-translate>{baseName(path()!)}</b>
          <span class="dim">версий: {items().length}</span>
          <span class="grow" />
          <button disabled={!current()} onClick={() => void compare()}>Сравнить с текущим</button>
          <button class="primary" disabled={!current()} onClick={() => void restore()}>Восстановить</button>
        </div>
        <Show
          when={items().length}
          fallback={<div class="tool-empty">Пока нет копий. Каждое сохранение (Ctrl+S) этого файла попадает сюда — даже без git.</div>}
        >
          <div class="history-slider">
            <span class="dim small">старее</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, items().length - 1)}
              value={items().length - 1 - pos()}
              onInput={(e) => setPos(items().length - 1 - Number(e.currentTarget.value))}
            />
            <span class="dim small">новее</span>
          </div>
          <div class="history-body">
            <div class="history-list">
              <For each={items()}>
                {(s, i) => (
                  <button classList={{ on: i() === pos() }} onClick={() => setPos(i())}>
                    <span>{ago(s.time)}</span>
                    <span class="dim small">{REASON[s.reason]}</span>
                    <Show when={delta(i())}>
                      {(d) => (
                        <span class="small">
                          <i class="ok">+{d().added}</i> <i class="err">−{d().removed}</i>
                        </span>
                      )}
                    </Show>
                  </button>
                )}
              </For>
              <button class="link small" onClick={() => void clearHistory(path()!)}>Удалить историю файла</button>
            </div>
            <pre class="tool-out mono history-preview" data-no-translate>{current()?.content}</pre>
          </div>
        </Show>
      </Show>
    </div>
  );
}
