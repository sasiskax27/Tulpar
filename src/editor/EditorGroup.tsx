// Группа редактора: полоса вкладок + один экземпляр Monaco, который переключается
// между моделями открытых файлов. Один редактор на много вкладок — так быстрее и легче.
import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js";
import { monaco, editorOptions } from "./monaco";
import {
  tabs, activePath, setActivePath, closeTab, modelFor,
  saveViewState, viewStateFor, setCursor, takeReveal,
} from "./tabs";
import { settings } from "../config/store";
import { executeCommand } from "../commands/registry";
import { keybindingFor } from "../keybindings/keybindings";

export default function EditorGroup() {
  let container!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let shownPath: string | null = null;

  onMount(() => {
    editor = monaco.editor.create(container, { ...editorOptions(settings()), model: null });
    editor.onDidChangeCursorPosition((e) =>
      setCursor({ line: e.position.lineNumber, column: e.position.column }),
    );
    onCleanup(() => editor?.dispose());
  });

  // Настройки из settings.json применяются на лету
  createEffect(() => {
    const opts = editorOptions(settings());
    monaco.editor.setTheme(opts.theme as string);
    editor?.updateOptions(opts);
  });

  // Переключение вкладки: запоминаем прокрутку и курсор старой, восстанавливаем у новой
  createEffect(
    on(activePath, (path) => {
      if (!editor) return;
      if (shownPath) saveViewState(shownPath, editor.saveViewState());
      const model = path ? modelFor(path) : undefined;
      editor.setModel(model ?? null);
      shownPath = model ? path : null;
      if (model && path) {
        const state = viewStateFor(path);
        if (state) editor.restoreViewState(state);
        const reveal = takeReveal(path);
        if (reveal) {
          editor.setSelection(reveal);
          editor.revealRangeInCenterIfOutsideViewport(reveal);
        }
        editor.focus();
      }
    }),
  );

  return (
    <div class="editor-group">
      <div class="tab-strip" role="tablist">
        <For each={tabs}>
          {(tab) => (
            <div
              class="tab"
              classList={{ active: tab.path === activePath(), dirty: tab.dirty }}
              role="tab"
              title={tab.path}
              onClick={() => setActivePath(tab.path)}
              onAuxClick={(e) => e.button === 1 && void closeTab(tab.path)}
            >
              <span class="tab-title">{tab.title}</span>
              <button
                class="tab-close"
                aria-label="Закрыть"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.path);
                }}
              >
                <span class="dot">●</span>
                <span class="x">×</span>
              </button>
            </div>
          )}
        </For>
      </div>
      <div class="editor-host">
        <div ref={container} class="monaco-container" classList={{ hidden: !activePath() }} />
        <Show when={!activePath()}>
          <Welcome />
        </Show>
      </div>
    </div>
  );
}

function Welcome() {
  const row = (title: string, command: string) => (
    <button class="welcome-row" onClick={() => void executeCommand(command)}>
      <span>{title}</span>
      <kbd>{keybindingFor(command) ?? ""}</kbd>
    </button>
  );
  return (
    <div class="welcome">
      <div class="welcome-logo">Tulpar</div>
      <div class="welcome-actions">
        {row("Открыть папку", "workbench.action.files.openFolder")}
        {row("Перейти к файлу", "workbench.action.quickOpen")}
        {row("Все команды", "workbench.action.showCommands")}
        {row("Настройки", "workbench.action.openSettings")}
      </div>
    </div>
  );
}
