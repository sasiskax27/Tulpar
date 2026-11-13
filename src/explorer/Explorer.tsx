// Дерево файлов. Базовая версия: ленивое раскрытие папок, открытие файлов,
// автообновление при изменениях на диске.
//
// ЗАДАЧИ НА НЕДЕЛЮ 1 (ваш модуль — см. docs/TASKS-week1.md):
//   [ ] Иконки по типу файла
//   [ ] Подсветка файла, открытого в активной вкладке
//   [ ] Навигация с клавиатуры (стрелки, Enter, ←/→ для сворачивания)
//   [ ] Контекстное меню: новый файл, новая папка, переименовать, удалить
//   [ ] Кнопка «Свернуть всё» в заголовке
import { createSignal, For, onCleanup, Show } from "solid-js";
import { core, baseName, type DirEntry } from "../ipc";
import { root, onDirChanged } from "../app/workspace";
import { openFile } from "../editor/tabs";
import { executeCommand } from "../commands/registry";

export default function Explorer() {
  return (
    <div class="explorer">
      <div class="panel-header">
        <span>Проводник</span>
      </div>
      <Show
        when={root()}
        keyed
        fallback={
          <div class="explorer-empty">
            <p>Папка не открыта</p>
            <button class="button" onClick={() => void executeCommand("workbench.action.files.openFolder")}>
              Открыть папку
            </button>
          </div>
        }
      >
        {(r) => (
          <div class="tree" role="tree">
            <div class="tree-root-name">{baseName(r)}</div>
            <DirChildren path={r} depth={0} />
          </div>
        )}
      </Show>
    </div>
  );
}

function DirChildren(props: { path: string; depth: number }) {
  const [entries, setEntries] = createSignal<DirEntry[]>([]);
  const load = () => core.readDir(props.path).then(setEntries).catch(() => setEntries([]));
  void load();
  onCleanup(onDirChanged(props.path, () => void load()));
  return <For each={entries()}>{(e) => <Node entry={e} depth={props.depth} />}</For>;
}

function Node(props: { entry: DirEntry; depth: number }) {
  const [open, setOpen] = createSignal(false);
  const indent = () => `${8 + props.depth * 12}px`;
  const click = () => (props.entry.isDir ? setOpen(!open()) : void openFile(props.entry.path));
  return (
    <>
      <div
        class="tree-item"
        role="treeitem"
        aria-expanded={props.entry.isDir ? open() : undefined}
        style={{ "padding-left": indent() }}
        onClick={click}
        title={props.entry.path}
      >
        <span class="twistie">{props.entry.isDir ? (open() ? "▾" : "▸") : ""}</span>
        <span class="tree-label">{props.entry.name}</span>
      </div>
      <Show when={props.entry.isDir && open()}>
        <DirChildren path={props.entry.path} depth={props.depth + 1} />
      </Show>
    </>
  );
}
