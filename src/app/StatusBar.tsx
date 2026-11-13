// Строка статуса. Базовая версия: папка, раскладка, позиция курсора, язык, отступы.
//
// ЗАДАЧИ НА НЕДЕЛЮ 1 (ваш модуль — см. docs/TASKS-week1.md):
//   [ ] Клик по «Строка, столбец» → перейти к строке (команда workbench.action.gotoLine)
//   [ ] Клик по раскладке → выбор раскладки из layout.json
//   [ ] Счётчик несохранённых файлов
import { Show } from "solid-js";
import { root } from "./workspace";
import { tabs, activePath, cursor } from "../editor/tabs";
import { languageName } from "../editor/monaco";
import { activeLayout, settings } from "../config/store";
import { baseName } from "../ipc";

export default function StatusBar() {
  const activeTab = () => tabs.find((t) => t.path === activePath());
  const indent = () =>
    settings()["editor.insertSpaces"] ? `Пробелы: ${settings()["editor.tabSize"]}` : `Табы: ${settings()["editor.tabSize"]}`;

  return (
    <footer class="status-bar" classList={{ "no-folder": !root() }}>
      <div class="status-left">
        <span class="status-item">{root() ? baseName(root()!) : "Нет открытой папки"}</span>
        <span class="status-item">⊞ {activeLayout()}</span>
      </div>
      <div class="status-right">
        <Show when={activeTab()}>
          {(tab) => (
            <>
              <span class="status-item">
                Стр {cursor().line}, стлб {cursor().column}
              </span>
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
