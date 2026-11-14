// Панель отладчика: тулбар управления, стек вызовов, переменные и вывод программы.
// Живёт в нижней панели отдельной вкладкой рядом с терминалом и проблемами.
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import {
  continueDebugging, frames, output, pausedLine, scopes, startDebugging, status,
  stepInto, stepOut, stepOver, stopDebugging, breakpointsVersion, breakpointFileMap,
  pauseDebugging, restartDebugging, selectFrame, currentFrame, loadVariables, evaluate,
  toggleBreakpoint, removeAllBreakpoints, clearOutput, type DebugVar,
} from "./debug";
import { activePath, openFile } from "../editor/tabs";

/** Строка переменной; списки, словари и объекты раскрываются по клику. */
function VarRow(props: { v: DebugVar; depth: number }) {
  const [open, setOpen] = createSignal(false);
  const [children] = createResource(
    () => (open() && props.v.variablesReference > 0 ? props.v.variablesReference : false),
    (ref) => loadVariables(ref as number),
  );
  const expandable = () => props.v.variablesReference > 0;
  return (
    <>
      <tr
        classList={{ "debug-var-expandable": expandable() }}
        title={props.v.type ? `${props.v.name}: ${props.v.type}` : props.v.name}
        onClick={() => expandable() && setOpen(!open())}
      >
        <td class="debug-var-name" style={{ "padding-left": `${6 + props.depth * 14}px` }}>
          <span class="debug-twisty">{expandable() ? (open() ? "▾" : "▸") : ""}</span>
          <span data-no-translate>{props.v.name}</span>
        </td>
        <td class="debug-var-value" data-no-translate>
          {props.v.value}
        </td>
      </tr>
      <Show when={open()}>
        <Show when={!children.loading} fallback={<tr><td class="debug-empty" colspan={2} style={{ "padding-left": `${20 + props.depth * 14}px` }}>…</td></tr>}>
          <For each={children() ?? []}>{(c) => <VarRow v={c} depth={props.depth + 1} />}</For>
        </Show>
      </Show>
    </>
  );
}

/** Короткое имя файла стека: без длинного пути, но с папкой для различения. */
function frameLabel(file: string): string {
  if (!file) return "(неизвестно)";
  return file.replace(/\\/g, "/").split("/").slice(-2).join("/");
}

const STATUS_LABEL: Record<string, string> = {
  off: "—",
  starting: "запуск…",
  running: "выполняется",
  stopped: "остановлен",
  ended: "завершено",
};

export default function DebugPanel() {
  const active = () => status() !== "off" && status() !== "ended";
  const canStep = () => status() === "stopped";
  const [expr, setExpr] = createSignal("");

  // Все точки останова — для списка внизу слева (пересобирается при любом изменении).
  const allBreakpoints = createMemo(() => {
    breakpointsVersion();
    return breakpointFileMap()
      .flatMap(([file, lines]) => lines.map((line) => ({ file, line, here: activePath() === file })))
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  });

  return (
    <div class="debug-panel">
      <div class="debug-toolbar">
        <div class="debug-toolbar-btns">
          <button
            class="debug-btn primary"
            title="Запустить отладку текущего файла (F5)"
            disabled={status() === "starting"}
            onClick={() => void startDebugging()}
          >
            ▶ Запустить
          </button>
          <span class="debug-sep" />
          <button class="debug-btn" title="Продолжить (F5)" disabled={!canStep()} onClick={() => void continueDebugging()}>
            ⏵ Продолжить
          </button>
          <button class="debug-btn" title="Пауза" disabled={status() !== "running"} onClick={() => void pauseDebugging()}>
            ⏸
          </button>
          <button class="debug-btn" title="Шаг через (F10)" disabled={!canStep()} onClick={() => void stepOver()}>
            ⇢ Через
          </button>
          <button class="debug-btn" title="Шаг в (F11)" disabled={!canStep()} onClick={() => void stepInto()}>
            ↓ В функцию
          </button>
          <button class="debug-btn" title="Шаг из (Shift+F11)" disabled={!canStep()} onClick={() => void stepOut()}>
            ↑ Из функции
          </button>
          <span class="debug-sep" />
          <button class="debug-btn" title="Перезапустить (Ctrl+Shift+F5)" disabled={!active()} onClick={() => void restartDebugging()}>
            ⟳
          </button>
          <button class="debug-btn danger" title="Остановить отладку (Shift+F5)" disabled={!active()} onClick={() => void stopDebugging()}>
            ■ Стоп
          </button>
        </div>
        <span class="debug-status" classList={{ stopped: status() === "stopped" }}>
          {STATUS_LABEL[status()] ?? status()}
        </span>
      </div>

      <div class="debug-body">
        <div class="debug-left">
          <div class="debug-section">
            <h4>Стек вызовов</h4>
            <Show when={frames().length} fallback={<p class="debug-empty">Нет активного останова</p>}>
              <ul class="debug-frames">
                <For each={frames()}>
                  {(f, i) => (
                    <li
                      class="debug-frame"
                      classList={{ top: i() === 0, current: currentFrame() === f.id, dim: !f.file }}
                      onClick={() => void selectFrame(f)}
                    >
                      <span class="debug-frame-line">стр. {f.line}</span>
                      <span class="debug-frame-name" title={f.file} data-no-translate>{f.name}</span>
                      <span class="debug-frame-file" title={f.file}>{frameLabel(f.file)}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>

          <div class="debug-section">
            <h4>
              Точки останова
              <Show when={allBreakpoints().length}>
                <span class="debug-count">{allBreakpoints().length}</span>
                <button class="debug-link" onClick={removeAllBreakpoints}>убрать все</button>
              </Show>
            </h4>
            <Show when={allBreakpoints().length} fallback={<p class="debug-empty">Клик слева от номера строки или F9 — поставить точку останова</p>}>
              <ul class="debug-breaks">
                <For each={allBreakpoints()}>
                  {(b) => (
                    <li
                      class="debug-break"
                      title={b.file}
                      onClick={() => void openFile(b.file, { startLineNumber: b.line, startColumn: 1, endLineNumber: b.line, endColumn: 1 })}
                    >
                      <span class="debug-break-dot" />
                      <span class="debug-break-name" data-no-translate>{frameLabel(b.file)}</span>
                      <span class="debug-break-line">стр. {b.line}</span>
                      <button
                        class="debug-break-remove"
                        title="Убрать"
                        aria-label="Убрать"
                        onClick={(e) => (e.stopPropagation(), toggleBreakpoint(b.file, b.line))}
                      >
                        ✕
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </div>

        <div class="debug-right">
          <div class="debug-section">
            <h4>
              Переменные
              <Show when={pausedLine()}>
                <span class="debug-here">строка {pausedLine()!.line}</span>
              </Show>
            </h4>
            <Show when={scopes().length} fallback={<p class="debug-empty">Остановитесь на строке — увидите значения</p>}>
              <div class="debug-vars">
                <For each={scopes()}>
                  {(scope) => (
                    <details class="debug-scope" open={scope.name === "Locals" || scope.name === "Локальные"}>
                      <summary>{scope.name === "Locals" ? "Локальные" : scope.name === "Globals" ? "Глобальные" : scope.name}</summary>
                      <table class="debug-var-table">
                        <tbody>
                          <For each={scope.vars}>{(v) => <VarRow v={v} depth={0} />}</For>
                          <Show when={!scope.vars.length}>
                            <tr>
                              <td class="debug-empty" colspan={2}>пусто</td>
                            </tr>
                          </Show>
                        </tbody>
                      </table>
                    </details>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="debug-section grow">
            <h4>
              Вывод
              <Show when={output().length}>
                <button class="debug-link" onClick={clearOutput}>очистить</button>
              </Show>
            </h4>
            <pre class="debug-console" ref={(el) => {
              // Автопрокрутка при появлении новых строк
              const mo = new MutationObserver(() => {
                el.scrollTop = el.scrollHeight;
              });
              mo.observe(el, { childList: true, characterData: true, subtree: true });
            }}>
              <Show when={output().length} fallback={<p class="debug-empty">Запустите отладку (F5) — здесь будет вывод программы</p>}>
                <For each={output()}>
                  {(line) => (
                    <span class={`debug-out ${line.kind}`} data-no-translate={line.kind === "info" ? undefined : ""}>
                      {line.text}
                    </span>
                  )}
                </For>
              </Show>
            </pre>
            <input
              class="debug-eval"
              placeholder={status() === "stopped" ? "Выражение, например len(items) — Enter" : "Вычислять выражения можно, когда программа на паузе"}
              disabled={status() !== "stopped"}
              value={expr()}
              spellcheck={false}
              onInput={(e) => setExpr(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void evaluate(expr());
                  setExpr("");
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
