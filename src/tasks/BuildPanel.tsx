// Раздел «Сборка»: найденные в проекте сборщики (Maven, Gradle, npm, Cargo, Go,
// Python, Make, CMake, .NET…) и их задачи — запуск одной кнопкой.
// Задачи выполняются во вкладке терминала «Задача».
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { detectTasks, runCurrentFile, runProjectTask, type ProjectTask } from "./tasks";
import { root } from "../app/workspace";
import { baseName } from "../ipc";
import { activePath } from "../editor/tabs";
import { executeCommand } from "../commands/registry";
import { interruptTerminal } from "../terminal/sessions";
import { notify } from "../app/notify";

const GROUP_ICON: Record<ProjectTask["group"], string> = { build: "⚙", test: "✔", run: "▶", other: "•" };
const GROUP_ORDER: ProjectTask["group"][] = ["run", "build", "test", "other"];

export default function BuildPanel() {
  const [list, setList] = createSignal<ProjectTask[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [last, setLast] = createSignal<string | null>(null);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());

  const refresh = async () => {
    if (!root()) {
      setList([]);
      return;
    }
    setLoading(true);
    try {
      setList(await detectTasks());
    } finally {
      setLoading(false);
    }
  };
  // Перечитываем при открытии раздела и при смене папки проекта
  createEffect(on(root, () => void refresh()));

  const groups = createMemo(() => {
    const map = new Map<string, ProjectTask[]>();
    for (const t of list()) {
      if (!map.has(t.source)) map.set(t.source, []);
      map.get(t.source)!.push(t);
    }
    for (const tasks of map.values()) tasks.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    return [...map.entries()];
  });

  const toggle = (source: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });

  const run = (t: ProjectTask) => {
    setLast(`${t.source}: ${t.label}`);
    void runProjectTask(t);
  };
  const stop = () => {
    if (!interruptTerminal("Задача")) notify("Сейчас ничего не запущено");
  };

  return (
    <div class="build-panel">
      <div class="panel-header">
        <span>Сборка и проекты</span>
        <div class="panel-actions">
          <button class="icon-button" title="Остановить задачу (Ctrl+C в терминале «Задача»)" aria-label="Остановить" onClick={stop}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
          </button>
          <button class="icon-button" title="Обновить" aria-label="Обновить" onClick={() => void refresh()}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" /></svg>
          </button>
        </div>
      </div>

      <Show
        when={root()}
        fallback={
          <div class="build-empty">
            <p>Откройте папку проекта — Tulpar сам найдёт Maven, Gradle, npm, Cargo и другие сборщики.</p>
            <button class="button" onClick={() => void executeCommand("workbench.action.files.openFolder")}>Открыть папку</button>
          </div>
        }
      >
        <div class="build-body">
          <div class="build-project">
            <span class="build-project-name">{baseName(root()!)}</span>
            <Show when={last()}>
              <span class="build-last" title="Последняя запущенная задача">↻ {last()}</span>
            </Show>
          </div>

          <Show when={activePath() && !activePath()!.startsWith("diff:")}>
            <button class="build-row build-run-file" onClick={() => void runCurrentFile()}>
              <span class="build-icon run">▶</span>
              <span class="build-label">Запустить текущий файл</span>
              <span class="build-detail">{baseName(activePath()!)}</span>
            </button>
          </Show>

          <Show when={!loading() || list().length} fallback={<div class="build-note">Ищу сборщики…</div>}>
            <Show
              when={groups().length}
              fallback={
                <div class="build-note">
                  В корне проекта сборщик не найден. Поддерживаются Maven, Gradle, npm/pnpm/yarn/bun, Cargo, Go, Python
                  (pip, Poetry, uv), Make, CMake, .NET, Docker и другие.
                </div>
              }
            >
              <For each={groups()}>
                {([source, tasks]) => (
                  <div class="build-group">
                    <button class="build-group-head" onClick={() => toggle(source)} aria-expanded={!collapsed().has(source)}>
                      <span class="twistie">{collapsed().has(source) ? "›" : "⌄"}</span>
                      <span class="build-source">{source}</span>
                      <span class="build-count">{tasks.length}</span>
                    </button>
                    <Show when={!collapsed().has(source)}>
                      <For each={tasks}>
                        {(t) => (
                          <button class="build-row" title={t.command} onClick={() => run(t)}>
                            <span class={`build-icon ${t.group}`}>{GROUP_ICON[t.group]}</span>
                            <span class="build-label">{t.label}</span>
                            <span class="build-play" aria-hidden="true">▶</span>
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
