// Раздел «Тесты»: запуск, дерево результатов, перезапуск и исправление с ИИ.
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { root } from "../app/workspace";
import { activePath, openFile } from "../editor/tabs";
import { core, joinPath } from "../ipc";
import { executeCommand } from "../commands/registry";
import { send, setAgentMode } from "../ai/chat";
import {
  detectFrameworks, framework, frameworks, lastRun, rawOutput, results, runTests, runTestsInTerminal, running, setFramework,
  type TestCase,
} from "./tests";

const ICON = { passed: "✓", failed: "✗", skipped: "–" } as const;

async function openTest(t: TestCase) {
  const r = root();
  if (!r || !t.file) return;
  let rel = t.file;
  // go test и cargo пишут только имя файла — ищем его в проекте
  if (!rel.includes("/")) {
    const files = (await core.listFiles().catch(() => [] as string[])).map((f) => f.replace(/\\/g, "/"));
    const match = files.filter((f) => f === rel || f.endsWith("/" + rel));
    if (match.length) rel = match[0];
  }
  const line = t.line ?? 1;
  void openFile(joinPath(r, rel), { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 });
}

async function fixWithAi(t: TestCase) {
  setAgentMode(true);
  await executeCommand("workbench.action.chat.open");
  const where = t.file ? ` (${t.file}${t.line ? ":" + t.line : ""})` : "";
  await send(
    `Тест «${t.name}»${where} падает.${t.file ? ` @${t.file}` : ""}\n\nОшибка:\n${(t.message ?? "").slice(0, 4000)}\n\n` +
      "Найди причину и исправь код. Если неправ сам тест — поправь тест и объясни почему.",
  );
}

function TestRow(props: { t: TestCase }) {
  const [open, setOpen] = createSignal(props.t.status === "failed");
  return (
    <div class={`test-row ${props.t.status}`}>
      <div class="test-line" onClick={() => (props.t.message ? setOpen(!open()) : void openTest(props.t))}>
        <span class="test-icon">{ICON[props.t.status]}</span>
        <span class="test-name" data-no-translate title={props.t.name}>
          {props.t.name}
        </span>
        <Show when={props.t.seconds && props.t.seconds >= 0.1}>
          <span class="test-time">{props.t.seconds!.toFixed(1)} с</span>
        </Show>
        <span class="test-actions">
          <Show when={props.t.file}>
            <button class="icon-button" title="Открыть" aria-label="Открыть" onClick={(e) => (e.stopPropagation(), void openTest(props.t))}>
              ↗
            </button>
          </Show>
          <Show when={props.t.selector}>
            <button
              class="icon-button"
              title="Запустить только этот тест"
              aria-label="Запустить только этот тест"
              disabled={running()}
              onClick={(e) => (e.stopPropagation(), void runTests(props.t))}
            >
              ▶
            </button>
          </Show>
        </span>
      </div>
      <Show when={open() && props.t.message}>
        <pre class="test-message" data-no-translate>
          {props.t.message!.length > 3000 ? props.t.message!.slice(0, 3000) + "\n…" : props.t.message}
        </pre>
        <Show when={props.t.status === "failed"}>
          <div class="test-fix-row">
            <button class="button-quiet" onClick={() => void fixWithAi(props.t)}>
              ✦ Исправить с ИИ
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export default function TestsPanel() {
  const [showOutput, setShowOutput] = createSignal(false);
  const [onlyFailed, setOnlyFailed] = createSignal(false);
  createEffect(on(root, () => void detectFrameworks()));

  const counts = createMemo(() => {
    const c = { passed: 0, failed: 0, skipped: 0 };
    for (const t of results()) c[t.status]++;
    return c;
  });

  const groups = createMemo(() => {
    const map = new Map<string, TestCase[]>();
    for (const t of results()) {
      if (onlyFailed() && t.status !== "failed") continue;
      map.set(t.group, [...(map.get(t.group) ?? []), t]);
    }
    // Группы с упавшими тестами — наверх
    return [...map.entries()].sort((a, b) => Number(b[1].some((t) => t.status === "failed")) - Number(a[1].some((t) => t.status === "failed")));
  });

  const currentFileTarget = () => {
    const p = activePath();
    const r = root();
    if (!p || !r) return null;
    const rel = p.slice(r.length + 1).replace(/\\/g, "/");
    return /(test|spec)/i.test(rel) ? rel : null;
  };

  return (
    <div class="tests-panel">
      <div class="panel-header">
        <span class="panel-title">Тесты</span>
        <div class="panel-actions">
          <button class="icon-button" title="Найти тесты заново" aria-label="Найти тесты заново" onClick={() => void detectFrameworks()}>
            ↻
          </button>
        </div>
      </div>

      <Show
        when={frameworks().length}
        fallback={
          <p class="tests-empty">
            <Show when={root()} fallback={"Откройте папку проекта."}>
              Тесты не найдены. Tulpar понимает pytest, Vitest, Jest, cargo test, go test, Maven, Gradle и .NET.
            </Show>
          </p>
        }
      >
        <div class="tests-top">
          <Show when={frameworks().length > 1}>
            <select
              class="tests-fw"
              value={framework()?.id}
              onChange={(e) => setFramework(frameworks().find((f) => f.id === e.currentTarget.value) ?? null)}
            >
              <For each={frameworks()}>{(f) => <option value={f.id}>{f.label}</option>}</For>
            </select>
          </Show>
          <div class="tests-buttons">
            <button class="button" disabled={running()} onClick={() => void runTests()}>
              {running() ? "Запускаю…" : `▶ Все тесты · ${framework()?.label ?? ""}`}
            </button>
            <Show when={currentFileTarget()}>
              <button class="button-quiet" disabled={running()} onClick={() => void runTests({ file: currentFileTarget()! })} title={currentFileTarget()!}>
                ▶ Этот файл
              </button>
            </Show>
            <button class="button-quiet" title="Запустить в терминале с живым выводом" onClick={() => void runTestsInTerminal()}>
              ⌨
            </button>
          </div>
        </div>

        <Show when={lastRun()}>
          <div class="tests-summary">
            <span class="ok">✓ {counts().passed}</span>
            <span class="bad">✗ {counts().failed}</span>
            <Show when={counts().skipped}>
              <span class="skip">– {counts().skipped}</span>
            </Show>
            <span class="tests-time">{(lastRun()!.millis / 1000).toFixed(1)} с</span>
            <Show when={counts().failed}>
              <label class="tests-filter">
                <input type="checkbox" checked={onlyFailed()} onChange={(e) => setOnlyFailed(e.currentTarget.checked)} />
                только упавшие
              </label>
            </Show>
          </div>
        </Show>

        <div class="tests-list">
          <For each={groups()}>
            {([group, list]) => (
              <details class="tests-group" open={list.some((t) => t.status === "failed") || groups().length <= 3}>
                <summary>
                  <span class={list.some((t) => t.status === "failed") ? "bad" : "ok"}>{list.some((t) => t.status === "failed") ? "✗" : "✓"}</span>
                  <span class="tests-group-name" data-no-translate>
                    {group}
                  </span>
                  <span class="tests-group-count">{list.length}</span>
                </summary>
                <For each={list}>{(t) => <TestRow t={t} />}</For>
              </details>
            )}
          </For>
          <Show when={lastRun() && !results().length && !running()}>
            <p class="tests-empty">Результатов нет — посмотрите вывод ниже.</p>
          </Show>
        </div>

        <Show when={rawOutput()}>
          <div class="tests-output">
            <button class="link-button" onClick={() => setShowOutput(!showOutput())}>
              {showOutput() ? "▾ Скрыть вывод" : "▸ Показать вывод"}
            </button>
            <Show when={showOutput()}>
              <pre data-no-translate>{rawOutput().slice(-20000)}</pre>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
