// Группа редактора: полоса вкладок + один экземпляр Monaco, который переключается
// между моделями открытых файлов. Один редактор на много вкладок — так быстрее и легче.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { monaco, editorOptions } from "./monaco";
import {
  tabs, activePath, setActivePath, closeTab, modelFor,
  saveViewState, viewStateFor, setCursor, takeReveal, diffModelsFor,
} from "./tabs";
import { settings } from "../config/store";
import { executeCommand } from "../commands/registry";
import { keybindingFor } from "../keybindings/keybindings";
import { setEditorInstance } from "./instance";
import { registerAiActions } from "../ai/ai";
import { breakpointsVersion, breakpointDecorationOptions, breakpointLines, registerDebugActions } from "../debug/debug";
import SidePane from "./SidePane";
import Welcome from "./Welcome";
import { currentPath, revealSymbol } from "./outline";
import { KIND } from "./symbols";

/** Путь файла относительно проекта, по частям. */
function crumbsOf(path: string): string[] {
  const r = root();
  const rel = r && path.toLowerCase().startsWith(r.toLowerCase()) ? path.slice(r.length + 1) : path;
  return rel.split(/[\\/]/).filter(Boolean);
}
import { isHtml, isMarkdown, previewHtml, previewMarkdown, side, splitEditor } from "./side";
import { root } from "../app/workspace";
import { registerFixActions } from "../problems/problems";
import { compareReview, keepAll, keepReview, reviewFor, reviews, undoReview } from "../ai/review";

export default function EditorGroup() {
  let container!: HTMLDivElement;
  let diffContainer!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
  let shownPath: string | null = null;
  const [diffMode, setDiffMode] = createSignal(false);

  // Редактор разницы создаём только когда он впервые понадобится
  const ensureDiffEditor = () => {
    if (!diffEditor) {
      diffEditor = monaco.editor.createDiffEditor(diffContainer, {
        ...editorOptions(settings()),
        renderSideBySide: true,
        originalEditable: false,
        ignoreTrimWhitespace: false,
      });
    }
    return diffEditor;
  };

  onMount(() => {
    editor = monaco.editor.create(container, { ...editorOptions(settings()), model: null });
    editor.onDidChangeCursorPosition((e) =>
      setCursor({ line: e.position.lineNumber, column: e.position.column }),
    );
    // Выделение тоже меняет «что приложится к вопросу» в чате
    editor.onDidChangeCursorSelection((e) =>
      setCursor({ line: e.selection.positionLineNumber, column: e.selection.positionColumn }),
    );
    setEditorInstance(editor);
    registerAiActions(editor);
    registerFixActions(editor);
    registerDebugActions(editor);
    onCleanup(() => {
      setEditorInstance(undefined);
      diffEditor?.dispose();
      editor?.dispose();
    });
  });

  let bpDecos: monaco.editor.IEditorDecorationsCollection | undefined;

  // Точки останова в желобе: перерисовка при смене файла и правках списка
  createEffect(() => {
    const path = activePath();
    breakpointsVersion();
    if (!editor) return;
    bpDecos ??= editor.createDecorationsCollection();
    bpDecos.set(breakpointDecorationOptions(path ? breakpointLines(path) : []));
  });

  // Настройки из settings.json применяются на лету
  createEffect(() => {
    const opts = editorOptions(settings());
    monaco.editor.setTheme(opts.theme as string);
    editor?.updateOptions(opts);
    diffEditor?.updateOptions(opts);
  });

  // Переключение вкладки: запоминаем прокрутку и курсор старой, восстанавливаем у новой
  createEffect(
    on(activePath, (path) => {
      if (!editor) return;
      if (shownPath) saveViewState(shownPath, editor.saveViewState());
      const diff = path ? diffModelsFor(path) : undefined;
      setDiffMode(!!diff);
      if (diff) {
        editor.setModel(null);
        shownPath = null;
        const d = ensureDiffEditor();
        d.setModel(diff);
        requestAnimationFrame(() => d.getModifiedEditor().focus());
        return;
      }
      diffEditor?.setModel(null);
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
      <div class="tab-strip" classList={{ empty: tabs.length === 0 }} role="tablist">
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
        <div class="tab-strip-spacer" />
        <Show when={activePath() && !activePath()!.startsWith("diff:")}>
          <div class="tab-strip-actions">
            <Show when={isMarkdown(activePath())}>
              <button class="icon-button" title="Предпросмотр Markdown (Ctrl+Shift+V)" aria-label="Предпросмотр" onClick={() => previewMarkdown()}>
                <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>
              </button>
            </Show>
            <Show when={isHtml(activePath())}>
              <button class="icon-button" title="Показать страницу рядом — обновляется на лету" aria-label="Просмотр страницы" onClick={() => previewHtml()}>
                <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M1.5 5.5h13" /></svg>
              </button>
            </Show>
            <button class="icon-button" title={`Открыть рядом (${keybindingFor("workbench.action.splitEditor") ?? "Ctrl+\\"})`} aria-label="Открыть рядом" onClick={() => void splitEditor()}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="M8 2.5v11" /></svg>
            </button>
            <button
              class="icon-button run-button"
              aria-label="Запустить файл"
              title={`Запустить файл (${keybindingFor("tulpar.run.file") ?? "Ctrl+F5"})`}
              onClick={() => void executeCommand("tulpar.run.file")}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4.5 2.8v10.4L13 8z" /></svg>
            </button>
            <button
              class="icon-button"
              aria-label="Задачи проекта"
              title={`Задачи проекта: сборка, тесты, запуск (${keybindingFor("workbench.action.tasks.runTask") ?? "Ctrl+Shift+B"})`}
              onClick={() => void executeCommand("workbench.action.tasks.runTask")}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></svg>
            </button>
          </div>
        </Show>
      </div>
      <Show when={activePath() && !activePath()!.startsWith("diff:") && settings()["breadcrumbs.enabled"] !== false}>
        <div class="breadcrumbs">
          <For each={crumbsOf(activePath()!)}>
            {(part, i) => (
              <>
                <Show when={i() > 0}><span class="crumb-sep">›</span></Show>
                <span class="crumb">{part}</span>
              </>
            )}
          </For>
          <For each={currentPath()}>
            {(sym) => (
              <>
                <span class="crumb-sep">›</span>
                <button class="crumb crumb-symbol" onClick={() => revealSymbol(sym)}>
                  <span class="outline-kind" style={{ color: (KIND[sym.kind] ?? ["", "#8B8B8B"])[1] }}>{(KIND[sym.kind] ?? ["•"])[0]}</span>
                  {sym.name}
                </button>
              </>
            )}
          </For>
        </div>
      </Show>
      <Show when={reviewFor(activePath())}>
        {(r) => (
          <div class="ai-review-bar" classList={{ pending: r().pending }} role="status">
            <span class="ai-review-spark" aria-hidden="true">✦</span>
            <span class="ai-review-text">
              {r().pending ? "ИИ предлагает правку" : r().before === null ? "ИИ создал файл" : "ИИ изменил файл"}
              <span class="ai-review-count">
                <span class="plus">+{r().added}</span> <span class="minus">−{r().removed}</span>
              </span>
            </span>
            <Show when={reviews().length > 1}>
              <span class="ai-review-more">ещё файлов: {reviews().length - 1}</span>
            </Show>
            <div class="ai-review-actions">
              <button class="ai-review-btn keep" onClick={() => keepReview(r())}>✓ {r().pending ? "Принять" : "Оставить"}</button>
              <button class="ai-review-btn" onClick={() => undoReview(r())}>↶ {r().pending ? "Отклонить" : "Отменить"}</button>
              <Show when={r().before !== null}>
                <button class="ai-review-btn" onClick={() => compareReview(r())}>Сравнить</button>
              </Show>
              <Show when={reviews().length > 1 && !reviews().some((x) => x.pending)}>
                <button class="ai-review-btn" onClick={keepAll}>Оставить все</button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <div class="editor-row">
      <div class="editor-host">
        <div ref={container} class="monaco-container" classList={{ hidden: !activePath() || diffMode() }} />
        <div ref={diffContainer} class="monaco-container" classList={{ hidden: !diffMode() }} />
        <Show when={!activePath()}>
          <Welcome />
        </Show>
      </div>
      <Show when={side()}>
        <SidePane />
      </Show>
      </div>
    </div>
  );
}

