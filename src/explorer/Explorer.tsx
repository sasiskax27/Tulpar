// Дерево файлов: ленивое раскрытие папок, автообновление при изменениях на диске,
// создание, переименование и удаление, контекстное меню и управление с клавиатуры.
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { core, baseName, parentDir, sepOf, type DirEntry } from "../ipc";
import { root, onDirChanged, reloadDir } from "../app/workspace";
import { activePath, openFile } from "../editor/tabs";
import { executeCommand } from "../commands/registry";
import { showContextMenu } from "../app/ContextMenu";
import {
  collapseAll, commitEditing, copyPath, editing, isExpanded, remove, selected,
  setEditing, setFolderOpen, setSelected, startNew, startRename,
} from "./fileOps";

const FILE_COLORS: Record<string, string> = {
  rs: "#F2A27A", ts: "#4FA3E0", tsx: "#4FA3E0", js: "#E9C46A", jsx: "#E9C46A", mjs: "#E9C46A",
  py: "#6FA8DC", go: "#5CC8B8", c: "#8FA7C9", h: "#8FA7C9", cpp: "#8FA7C9", hpp: "#8FA7C9", cs: "#9E7FD6",
  java: "#E08A5B", kt: "#B48CF0", json: "#C9A0F2", toml: "#C9A0F2", yaml: "#C9A0F2", yml: "#C9A0F2",
  md: "#9ED4A2", txt: "#9AA0A6", css: "#B4A7F5", scss: "#E58FB8", html: "#F2A27A", svg: "#F0B840",
  png: "#F0B840", jpg: "#F0B840", jpeg: "#F0B840", gif: "#F0B840", lock: "#6B7280", sh: "#9ED4A2", ps1: "#4FA3E0",
};

function fileColor(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return FILE_COLORS[ext] ?? "#8B8B8B";
}

function HeaderButton(props: { label: string; onClick: () => void; children?: JSX.Element }) {
  return (
    <button class="icon-button" aria-label={props.label} title={props.label} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export default function Explorer() {
  let tree: HTMLDivElement | undefined;

  const target = () => {
    // Куда создавать: в выделенную папку, рядом с выделенным файлом или в корень
    const sel = selected();
    const r = root()!;
    if (!sel) return r;
    const item = tree?.querySelector<HTMLElement>(`[data-path="${CSS.escape(sel)}"]`);
    return item?.dataset.dir === "1" ? sel : parentDir(sel);
  };
  const create = (kind: "file" | "folder") => {
    const parent = target();
    startNew(kind, parent, parent === root());
  };

  const onKey = (e: KeyboardEvent) => {
    if (!tree || editing()) return;
    const items = [...tree.querySelectorAll<HTMLElement>(".tree-item[data-path]")];
    const index = items.findIndex((el) => el.dataset.path === selected());
    const current = items[index];
    const select = (el: HTMLElement | undefined) => {
      if (!el) return;
      setSelected(el.dataset.path!);
      el.scrollIntoView({ block: "nearest" });
    };
    const isDir = current?.dataset.dir === "1";
    const path = current?.dataset.path;
    switch (e.key) {
      case "ArrowDown":
        select(items[Math.min(index + 1, items.length - 1)] ?? items[0]);
        break;
      case "ArrowUp":
        select(items[Math.max(index - 1, 0)]);
        break;
      case "ArrowRight":
        if (path && isDir) {
          if (!isExpanded(path)) setFolderOpen(path, true);
          else select(items[index + 1]);
        }
        break;
      case "ArrowLeft":
        if (path && isDir && isExpanded(path)) setFolderOpen(path, false);
        else if (path) select(items.find((el) => el.dataset.path === parentDir(path)));
        break;
      case "Enter":
        if (path) isDir ? setFolderOpen(path, !isExpanded(path)) : void openFile(path);
        break;
      case "F2":
        if (path) startRename(path);
        break;
      case "Delete":
        if (path) void remove(path, isDir);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div class="explorer">
      <div class="panel-header">
        <span>Проводник</span>
        <Show when={root()}>
          <div class="panel-actions">
            <HeaderButton label="Новый файл" onClick={() => create("file")}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5z" /><path d="M9 1.5v4h4M8 8v4M6 10h4" /></svg>
            </HeaderButton>
            <HeaderButton label="Новая папка" onClick={() => create("folder")}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" /><path d="M8 7v4M6 9h4" /></svg>
            </HeaderButton>
            <HeaderButton label="Обновить" onClick={() => reloadDir(root()!)}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" /></svg>
            </HeaderButton>
            <HeaderButton label="Свернуть всё" onClick={collapseAll}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 8h6" /></svg>
            </HeaderButton>
          </div>
        </Show>
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
          <div
            ref={tree}
            class="tree"
            role="tree"
            tabIndex={0}
            onKeyDown={onKey}
            onContextMenu={(e) =>
              showContextMenu(e, [
                { label: "Новый файл…", run: () => startNew("file", r, true) },
                { label: "Новая папка…", run: () => startNew("folder", r, true) },
                "-",
                { label: "Обновить", run: () => reloadDir(r) },
                { label: "Свернуть всё", run: collapseAll },
              ])
            }
          >
            <div class="tree-root-name">{baseName(r)}</div>
            <DirChildren path={r} depth={0} />
          </div>
        )}
      </Show>
    </div>
  );
}

function NameInput(props: { initial: string; depth: number; icon: "file" | "folder" }) {
  let done = false;
  const finish = (value: string | null) => {
    if (done) return;
    done = true;
    if (value === null) setEditing(null);
    else void commitEditing(value);
  };
  return (
    <div class="tree-item editing" style={{ "padding-left": `${8 + props.depth * 12}px` }}>
      <span class="twistie" />
      <span class="tree-icon">
        {props.icon === "folder" ? <FolderIcon open={false} /> : <span class="file-dot" style={{ background: "#8B8B8B" }} />}
      </span>
      <input
        ref={(el) =>
          queueMicrotask(() => {
            el.focus();
            // Выделяем имя без расширения, как в VS Code
            const dot = props.initial.lastIndexOf(".");
            el.setSelectionRange(0, dot > 0 ? dot : props.initial.length);
          })
        }
        class="tree-input"
        value={props.initial}
        aria-label="Имя"
        spellcheck={false}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(e.currentTarget.value);
          if (e.key === "Escape") finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </div>
  );
}

function FolderIcon(props: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2">
      {props.open ? (
        <path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h5a1 1 0 0 1 1 1V6H4.2a1 1 0 0 0-.95.7L1.5 12.5zM1.5 12.5 3.3 7h11.2l-1.8 5.5z" />
      ) : (
        <path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
      )}
    </svg>
  );
}

function DirChildren(props: { path: string; depth: number }) {
  const [entries, setEntries] = createSignal<DirEntry[]>([]);
  const load = () => core.readDir(props.path).then(setEntries).catch(() => setEntries([]));
  void load();
  onCleanup(onDirChanged(props.path, () => void load()));
  const newHere = () => {
    const e = editing();
    return e && e.kind !== "rename" && e.parent === props.path ? e.kind : null;
  };
  return (
    <>
      <Show when={newHere()} keyed>
        {(kind) => <NameInput initial="" depth={props.depth} icon={kind} />}
      </Show>
      <For each={entries()}>{(e) => <Node entry={e} depth={props.depth} />}</For>
    </>
  );
}

function Node(props: { entry: DirEntry; depth: number }) {
  const path = () => props.entry.path;
  const open = () => props.entry.isDir && isExpanded(path());
  const renaming = () => {
    const e = editing();
    return e?.kind === "rename" && e.path === path();
  };
  const click = () => {
    setSelected(path());
    if (props.entry.isDir) setFolderOpen(path(), !open());
    else void openFile(path());
  };
  const menu = (e: MouseEvent) => {
    setSelected(path());
    const dir = props.entry.isDir ? path() : parentDir(path());
    showContextMenu(e, [
      { label: "Новый файл…", run: () => startNew("file", dir, dir === root()) },
      { label: "Новая папка…", run: () => startNew("folder", dir, dir === root()) },
      "-",
      { label: "Переименовать…", shortcut: "F2", run: () => startRename(path()) },
      { label: "Копировать путь", run: () => void copyPath(path()) },
      {
        label: "Копировать относительный путь",
        run: () => void copyPath(path().slice(root()!.length + 1).split(sepOf(path())).join("/")),
      },
      "-",
      { label: "Удалить", shortcut: "Delete", danger: true, run: () => void remove(path(), props.entry.isDir) },
    ]);
  };
  return (
    <>
      <Show
        when={!renaming()}
        fallback={<NameInput initial={props.entry.name} depth={props.depth} icon={props.entry.isDir ? "folder" : "file"} />}
      >
        <div
          class="tree-item"
          classList={{ active: activePath() === path(), selected: selected() === path() }}
          role="treeitem"
          aria-expanded={props.entry.isDir ? open() : undefined}
          aria-selected={selected() === path()}
          data-path={path()}
          data-dir={props.entry.isDir ? "1" : "0"}
          style={{ "padding-left": `${8 + props.depth * 12}px` }}
          onClick={click}
          onContextMenu={menu}
          title={path()}
        >
          <span class="twistie">{props.entry.isDir ? (open() ? "▾" : "▸") : ""}</span>
          <span class="tree-icon">
            {props.entry.isDir ? <FolderIcon open={open()} /> : <span class="file-dot" style={{ background: fileColor(props.entry.name) }} />}
          </span>
          <span class="tree-label">{props.entry.name}</span>
        </div>
      </Show>
      <Show when={open()}>
        <DirChildren path={path()} depth={props.depth + 1} />
      </Show>
    </>
  );
}
