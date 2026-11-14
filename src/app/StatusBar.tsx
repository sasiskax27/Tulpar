// Строка статуса: папка, ветка git, раскладка, несохранённые файлы, позиция курсора, язык.
import { Show } from "solid-js";
import { root } from "./workspace";
import { tabs, activePath, cursor } from "../editor/tabs";
import { languageName } from "../editor/monaco";
import { activeLayout, settings } from "../config/store";
import { baseName } from "../ipc";
import { executeCommand } from "../commands/registry";
import { status as gitStatus, busy as gitBusy } from "../git/git";
import { counts, showProblems } from "../problems/problems";

export default function StatusBar() {
  const activeTab = () => tabs.find((t) => t.path === activePath());
  const unsaved = () => tabs.filter((t) => t.dirty && !t.diffOf).length;
  const indent = () =>
    settings()["editor.insertSpaces"] ? `Пробелы: ${settings()["editor.tabSize"]}` : `Табы: ${settings()["editor.tabSize"]}`;

  return (
    <footer class="status-bar">
      <div class="status-left">
        <span class="status-item">{root() ? baseName(root()!) : "Нет открытой папки"}</span>
        <Show when={gitStatus()?.isRepo}>
          <button class="status-item accent" title="Переключить ветку" onClick={() => void executeCommand("git.checkout")}>
            ⎇ {gitStatus()?.branch ?? "без ветки"}
            <Show when={gitStatus()?.ahead || gitStatus()?.behind}>
              {"  "}↓{gitStatus()?.behind} ↑{gitStatus()?.ahead}
            </Show>
          </button>
        </Show>
        <button
          class="status-item"
          classList={{ "has-errors": counts().errors > 0 }}
          title="Проблемы (Ctrl+Shift+M)"
          onClick={showProblems}
        >
          ⊗ {counts().errors}  ⚠ {counts().warnings}
        </button>
        <Show when={gitBusy()}>
          <span class="status-item">{gitBusy()}…</span>
        </Show>
        <button class="status-item" title="Следующая раскладка" onClick={() => void executeCommand("tulpar.layout.next")}>
          ⊞ {activeLayout()}
        </button>
        <Show when={unsaved()}>
          <button class="status-item warn" title="Сохранить всё (Ctrl+Alt+S)" onClick={() => void executeCommand("workbench.action.files.saveAll")}>
            ● Не сохранено: {unsaved()}
          </button>
        </Show>
      </div>
      <div class="status-right">
        <Show when={activeTab()}>
          {(tab) => (
            <>
              <button class="status-item" title="Перейти к строке (Ctrl+G)" onClick={() => void executeCommand("workbench.action.gotoLine")}>
                Стр {cursor().line}, стлб {cursor().column}
              </button>
              <span class="status-item">{indent()}</span>
              <span class="status-item">UTF-8</span>
              <span class="status-item">{languageName(tab().languageId)}</span>
            </>
          )}
        </Show>
      </div>
    </footer>
  );
}
