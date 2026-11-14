// Панель «Проблемы»: ошибки и предупреждения, сгруппированные по файлам.
// Клик — перейти к месту; «Исправить с ИИ» — отдать агенту.
import { createMemo, createSignal, For, Show } from "solid-js";
import { problems, counts, relOf, goTo, fixWithAi, type Problem } from "./problems";
import { baseName } from "../ipc";

export default function ProblemsPanel() {
  const [onlyErrors, setOnlyErrors] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());

  const groups = createMemo(() => {
    const map = new Map<string, Problem[]>();
    for (const p of problems()) {
      if (onlyErrors() && p.severity !== "error") continue;
      if (!map.has(p.path)) map.set(p.path, []);
      map.get(p.path)!.push(p);
    }
    return [...map.entries()];
  });
  const visible = () => groups().flatMap(([, list]) => list);

  const toggle = (path: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div class="problems-panel">
      <div class="problems-toolbar">
        <span class="problems-summary">
          <span class="sev error">⊗ {counts().errors}</span>
          <span class="sev warning">⚠ {counts().warnings}</span>
        </span>
        <label class="problems-filter">
          <input type="checkbox" checked={onlyErrors()} onChange={(e) => setOnlyErrors(e.currentTarget.checked)} />
          только ошибки
        </label>
        <div class="problems-spacer" />
        <Show when={visible().length}>
          <button class="button-quiet problems-fix-all" onClick={() => void fixWithAi(visible())}>
            ✦ Исправить всё с ИИ
          </button>
        </Show>
      </div>
      <div class="problems-list">
        <Show
          when={groups().length}
          fallback={
            <div class="problems-empty">
              Проблем не найдено. Ошибки появляются, когда открыт файл и для его языка работает языковой сервер.
            </div>
          }
        >
          <For each={groups()}>
            {([path, list]) => (
              <div class="problems-group">
                <div class="problems-file" onClick={() => toggle(path)}>
                  <span class="twistie">{collapsed().has(path) ? "›" : "⌄"}</span>
                  <span class="problems-file-name">{baseName(path)}</span>
                  <span class="problems-file-dir">{relOf(path)}</span>
                  <span class="problems-file-count">{list.length}</span>
                  <button
                    class="problems-fix"
                    title="Исправить проблемы этого файла с ИИ"
                    onClick={(e) => {
                      e.stopPropagation();
                      void fixWithAi(list);
                    }}
                  >
                    ✦ Исправить
                  </button>
                </div>
                <Show when={!collapsed().has(path)}>
                  <For each={list}>
                    {(p) => (
                      <div class="problems-row" onClick={() => goTo(p)} title={p.message}>
                        <span class={`sev ${p.severity}`}>{p.severity === "error" ? "⊗" : p.severity === "warning" ? "⚠" : "ⓘ"}</span>
                        <span class="problems-msg">{p.message}</span>
                        <span class="problems-src">
                          {p.source ?? ""}
                          {p.code ? `(${p.code})` : ""}
                        </span>
                        <span class="problems-pos">[{p.line}, {p.column}]</span>
                        <button
                          class="problems-fix"
                          title="Исправить с ИИ"
                          onClick={(e) => {
                            e.stopPropagation();
                            void fixWithAi([p]);
                          }}
                        >
                          ✦
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
