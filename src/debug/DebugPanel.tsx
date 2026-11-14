// Панель отладчика: тулбар управления, стек вызовов, переменные и вывод программы.
// Живёт в нижней панели отдельной вкладкой рядом с терминалом и проблемами.
import { For, Show, createMemo } from "solid-js";
import {
  continueDebugging, frames, output, pausedLine, scopes, startDebugging, status,
  stepInto, stepOut, stepOver, stopDebugging, breakpointsVersion, breakpointFileMap,
} from "./debug";
import { activePath } from "../editor/tabs";

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
          <button class="debug-btn" title="Продолжить (F10)" disabled={!canStep()} onClick={() => void continueDebugging()}>
            ⏵ Продолжить
          </button>
          <button class="debug-btn" title="Шаг через (F11)" disabled={!canStep()} onClick={() => void stepOver()}>
            ⇢ Через
          </button>
          <button class="debug-btn" title="Шаг в (Alt+F11)" disabled={!canStep()} onClick={() => void stepInto()}>
            ↓ В функцию
          </button>
          <button class="debug-btn" title="Шаг из (Shift+F11)" disabled={!canStep()} onClick={() => void stepOut()}>
            ↑ Из функции
          </button>
          <span class="debug-sep" />
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
                    <li class="debug-frame" classList={{ top: i() === 0 }}>
                      <span class="debug-frame-line">стр. {f.line}</span>
                      <span class="debug-frame-name" title={f.file}>{f.name}</span>
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
              </Show>
            </h4>
            <Show when={allBreakpoints().length} fallback={<p class="debug-empty">Правый клик по строке в редакторе → «Точка останова»</p>}>
              <ul class="debug-breaks">
                <For each={allBreakpoints()}>
                  {(b) => (
                    <li class="debug-break" title={b.file}>
                      <span class="debug-break-dot" />
                      <span class="debug-break-name">{frameLabel(b.file)}</span>
                      <span class="debug-break-line">стр. {b.line}</span>
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
                      <summary>{scope.name}</summary>
                      <table class="debug-var-table">
                        <tbody>
                          <For each={scope.vars}>
                            {(v) => (
                              <tr title={v.type ? `${v.name}: ${v.type}` : v.name}>
                                <td class="debug-var-name">{v.name}</td>
                                <td class="debug-var-value">{v.value}</td>
                              </tr>
                            )}
                          </For>
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
            <h4>Вывод</h4>
            <pre class="debug-console" ref={(el) => {
              // Автопрокрутка при появлении новых строк
              const mo = new MutationObserver(() => {
                el.scrollTop = el.scrollHeight;
              });
              mo.observe(el, { childList: true, characterData: true, subtree: true });
            }}>
              <Show when={output().length} fallback={<p class="debug-empty">Запустите отладку (F5) — здесь будет вывод программы</p>}>
                <For each={output()}>
                  {(line) => <span class={`debug-out ${line.kind}`}>{line.text}</span>}
                </For>
              </Show>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
