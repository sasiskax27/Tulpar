// Редактор блокнота: ячейки кода и текста, запуск по Shift+Enter, вывод,
// графики matplotlib и таблицы pandas прямо под ячейкой.
import { createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { monaco, editorOptions } from "../editor/monaco";
import { settings } from "../config/store";
import { core } from "../ipc";
import { notify, notifyError } from "../app/notify";
import { markdownToHtml } from "../editor/markdown";
import { askInput } from "../app/InputBox";
import { runInTerminal } from "../terminal/sessions";
import { Kernel, newId, parseNotebook, serializeNotebook, type Cell, type NotebookDoc, type Output } from "./notebook";

type KernelState = "off" | "starting" | "idle" | "busy";

function CodeEditor(props: { cell: Cell; language: string; onChange: (v: string) => void; onRun: (advance: boolean) => void; focus?: boolean }) {
  let host!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  onMount(() => {
    const base = editorOptions(settings());
    editor = monaco.editor.create(host, {
      ...base,
      value: props.cell.source,
      language: props.language,
      minimap: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      scrollBeyondLastLine: false,
      scrollbar: { vertical: "hidden", alwaysConsumeMouseWheel: false },
      overviewRulerLanes: 0,
      renderLineHighlight: "none",
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
    });
    const resize = () => {
      const h = Math.min(Math.max(editor!.getContentHeight(), 38), 900);
      host.style.height = `${h}px`;
      editor!.layout();
    };
    editor.onDidContentSizeChange(resize);
    resize();
    editor.onDidChangeModelContent(() => props.onChange(editor!.getValue()));
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => props.onRun(true));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => props.onRun(false));
    if (props.focus) editor.focus();
  });
  onCleanup(() => {
    editor?.getModel()?.dispose();
    editor?.dispose();
  });
  return <div class="nb-editor" ref={host} />;
}

function OutputView(props: { out: Output }) {
  const o = () => props.out;
  return (
    <Switch>
      <Match when={o().output_type === "stream"}>
        <pre class="nb-stream" classList={{ err: o().name === "stderr" }} data-no-translate>
          {o().text}
        </pre>
      </Match>
      <Match when={o().output_type === "error"}>
        <pre class="nb-error" data-no-translate>
          {(o().traceback ?? []).join("\n").replace(/\u001b\[[0-9;]*m/g, "") || `${o().ename}: ${o().evalue}`}
        </pre>
      </Match>
      <Match when={o().data?.["image/png"]}>
        <img class="nb-image" src={`data:image/png;base64,${o().data!["image/png"].replace(/\s/g, "")}`} alt="график" />
      </Match>
      <Match when={o().data?.["text/html"]}>
        {/* HTML из ячейки — в изолированной рамке без скриптов */}
        <iframe
          class="nb-html"
          sandbox="allow-same-origin"
          srcdoc={`<style>body{margin:0;font:12px system-ui;color:#ddd;background:transparent}table{border-collapse:collapse}td,th{border:1px solid #555;padding:3px 8px;text-align:right}th{background:#2a2a2a}</style>${o().data!["text/html"]}`}
          onLoad={(e) => {
            const f = e.currentTarget;
            const h = f.contentDocument?.documentElement.scrollHeight ?? 200;
            f.style.height = `${Math.min(h + 8, 500)}px`;
          }}
        />
      </Match>
      <Match when={o().data?.["text/markdown"]}>
        <div class="nb-md" innerHTML={markdownToHtml(o().data!["text/markdown"])} />
      </Match>
      <Match when={o().data?.["text/plain"] !== undefined}>
        <pre class="nb-stream" data-no-translate>
          {o().data!["text/plain"]}
        </pre>
      </Match>
    </Switch>
  );
}

export default function NotebookView(props: { path: string }) {
  const [doc, setDoc] = createStore<NotebookDoc>({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 });
  const [loaded, setLoaded] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [kstate, setKstate] = createSignal<KernelState>("off");
  const [running, setRunning] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [focusId, setFocusId] = createSignal<string | null>(null);
  let kernel: Kernel | null = null;
  const queue: string[] = [];

  const language = () => String((doc.metadata as any)?.language_info?.name ?? "python");

  onMount(async () => {
    try {
      const text = await core.readFile(props.path).catch(() => "");
      setDoc(reconcile(parseNotebook(text)));
      setLoaded(true);
    } catch (e) {
      notifyError("Не удалось открыть блокнот", e);
    }
  });
  onCleanup(() => void kernel?.stop());

  const markDirty = () => setDirty(true);

  const save = async () => {
    try {
      await core.writeFile(props.path, serializeNotebook(JSON.parse(JSON.stringify(doc))));
      setDirty(false);
    } catch (e) {
      notifyError("Не удалось сохранить блокнот", e);
    }
  };

  const cellIndex = (id: string) => doc.cells.findIndex((c) => c.id === id);

  const ensureKernel = async (): Promise<Kernel | null> => {
    if (kernel) return kernel;
    setKstate("starting");
    try {
      kernel = await Kernel.start(props.path, {
        onOutput: (id, out) => {
          setDoc(
            "cells",
            (c) => c.id === id,
            produce((c) => {
              const last = c.outputs[c.outputs.length - 1];
              // Куски print() склеиваем в один вывод
              if (out.output_type === "stream" && last?.output_type === "stream" && last.name === out.name) last.text = (last.text ?? "") + out.text;
              else c.outputs.push(out);
            }),
          );
        },
        onDone: (id, count) => {
          setDoc("cells", (c) => c.id === id, "execution_count", count);
          markDirty();
          next();
        },
        onInput: async (_id, prompt) => (await askInput({ title: "Ввод для ячейки", placeholder: prompt || "input()" })) ?? "",
        onExit: (stderr) => {
          kernel = null;
          queue.length = 0;
          setRunning(null);
          setKstate("off");
          if (stderr.trim()) notify(`Ядро остановилось: ${stderr.trim().split("\n").slice(-2).join(" ")}`, "error");
        },
      });
      setKstate("idle");
      return kernel;
    } catch (e) {
      setKstate("off");
      notify("Не удалось запустить Python для блокнота. Он установлен? Настройки → SDK и инструменты.", "error");
      notifyError("Блокнот", e);
      return null;
    }
  };

  function next() {
    const id = queue.shift() ?? null;
    setRunning(id);
    if (!id) {
      setKstate(kernel ? "idle" : "off");
      return;
    }
    const cell = doc.cells.find((c) => c.id === id);
    if (!cell || !kernel) return next();
    setKstate("busy");
    setDoc("cells", (c) => c.id === id, produce((c) => {
      c.outputs = [];
      c.execution_count = null;
    }));
    kernel.execute(id, cell.source);
  }

  const runCells = async (ids: string[]) => {
    const k = await ensureKernel();
    if (!k) return;
    queue.push(...ids.filter((id) => doc.cells.find((c) => c.id === id)?.cell_type === "code"));
    if (!running()) next();
  };

  const runCell = async (id: string, advance: boolean) => {
    const cell = doc.cells.find((c) => c.id === id);
    if (cell?.cell_type === "markdown") setEditing(null);
    else await runCells([id]);
    if (advance) {
      const i = cellIndex(id);
      if (i === doc.cells.length - 1) addCell("code", i);
      else setFocusId(doc.cells[i + 1].id);
    }
  };

  const addCell = (type: Cell["cell_type"], after: number) => {
    const cell: Cell = { id: newId(), cell_type: type, source: "", outputs: [], execution_count: null, metadata: {}, extra: {} };
    setDoc("cells", produce((list) => list.splice(after + 1, 0, cell)));
    setFocusId(cell.id);
    if (type === "markdown") setEditing(cell.id);
    markDirty();
  };

  const removeCell = (id: string) => {
    setDoc("cells", (list) => list.filter((c) => c.id !== id));
    markDirty();
  };

  const moveCell = (id: string, delta: number) => {
    const i = cellIndex(id);
    const j = i + delta;
    if (j < 0 || j >= doc.cells.length) return;
    setDoc("cells", produce((list) => {
      const [c] = list.splice(i, 1);
      list.splice(j, 0, c);
    }));
    markDirty();
  };

  const restart = async () => {
    queue.length = 0;
    setRunning(null);
    await kernel?.stop();
    kernel = null;
    setKstate("off");
    await ensureKernel();
  };

  const clearOutputs = () => {
    setDoc("cells", {}, produce((c) => {
      c.outputs = [];
      c.execution_count = null;
    }));
    markDirty();
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      void save();
    }
  };

  const STATE_LABEL: Record<KernelState, string> = { off: "ядро не запущено", starting: "запускаю Python…", idle: "готово", busy: "выполняется…" };

  return (
    <div class="nb" onKeyDown={onKey}>
      <div class="nb-toolbar">
        <button class="button" disabled={!loaded() || kstate() === "starting"} onClick={() => void runCells(doc.cells.map((c) => c.id))}>
          ▶ Запустить всё
        </button>
        <button class="button-quiet" onClick={() => addCell("code", doc.cells.length - 1)}>+ Код</button>
        <button class="button-quiet" onClick={() => addCell("markdown", doc.cells.length - 1)}>+ Текст</button>
        <button class="button-quiet" title="Перезапустить ядро: все переменные сбросятся" onClick={() => void restart()}>⟳ Ядро</button>
        <button class="button-quiet" title="Очистить вывод всех ячеек" onClick={clearOutputs}>⌫ Вывод</button>
        <button
          class="button-quiet"
          title="Установить популярные библиотеки для анализа данных: numpy, pandas, matplotlib"
          onClick={() => void runInTerminal(`${kernel?.python ?? (navigator.userAgent.includes("Windows") ? "python" : "python3")} -m pip install numpy pandas matplotlib`, "Блокнот")}
        >
          📦
        </button>
        <span class="nb-state" classList={{ busy: kstate() === "busy" || kstate() === "starting" }}>
          ● {STATE_LABEL[kstate()]}
        </span>
        <button class="button-quiet" disabled={!dirty()} title="Сохранить (Ctrl+S)" onClick={() => void save()}>
          {dirty() ? "💾 Сохранить" : "Сохранено"}
        </button>
      </div>

      <div class="nb-cells">
        <For each={doc.cells}>
          {(cell, i) => (
            <div class="nb-cell" classList={{ running: running() === cell.id, md: cell.cell_type === "markdown" }}>
              <div class="nb-gutter">
                <Show when={cell.cell_type === "code"}>
                  <button class="nb-run" title="Выполнить (Shift+Enter)" aria-label="Выполнить" onClick={() => void runCell(cell.id, false)}>
                    {running() === cell.id ? "◌" : "▶"}
                  </button>
                  <span class="nb-count">[{running() === cell.id ? "*" : cell.execution_count ?? " "}]</span>
                </Show>
              </div>
              <div class="nb-body">
                <Show
                  when={cell.cell_type === "code" || editing() === cell.id}
                  fallback={
                    <div
                      class="nb-md"
                      title="Двойной клик — редактировать"
                      onDblClick={() => setEditing(cell.id)}
                      innerHTML={cell.source.trim() ? markdownToHtml(cell.source) : "<p class='nb-placeholder'>Пустой текст — двойной клик, чтобы написать</p>"}
                    />
                  }
                >
                  <CodeEditor
                    cell={cell}
                    language={cell.cell_type === "markdown" ? "markdown" : language()}
                    focus={focusId() === cell.id}
                    onChange={(v) => {
                      setDoc("cells", i(), "source", v);
                      markDirty();
                    }}
                    onRun={(advance) => void runCell(cell.id, advance)}
                  />
                </Show>
                <Show when={cell.outputs.length}>
                  <div class="nb-outputs">
                    <For each={cell.outputs}>{(o) => <OutputView out={o} />}</For>
                  </div>
                </Show>
              </div>
              <div class="nb-cell-actions">
                <button class="icon-button" title="Выше" aria-label="Выше" onClick={() => moveCell(cell.id, -1)}>↑</button>
                <button class="icon-button" title="Ниже" aria-label="Ниже" onClick={() => moveCell(cell.id, 1)}>↓</button>
                <button
                  class="icon-button"
                  title={cell.cell_type === "code" ? "Сделать текстом" : "Сделать кодом"}
                  onClick={() => {
                    setDoc("cells", i(), produce((c) => {
                      c.cell_type = c.cell_type === "code" ? "markdown" : "code";
                      c.outputs = [];
                    }));
                    markDirty();
                  }}
                >
                  {cell.cell_type === "code" ? "M↓" : "{ }"}
                </button>
                <button class="icon-button" title="Удалить ячейку" aria-label="Удалить ячейку" onClick={() => removeCell(cell.id)}>✕</button>
              </div>
              <div class="nb-add">
                <button onClick={() => addCell("code", i())}>+ Код</button>
                <button onClick={() => addCell("markdown", i())}>+ Текст</button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
