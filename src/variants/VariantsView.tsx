// Три варианта рядом: код (или живая страница для HTML) и кнопка «Выбрать».
import { For, Show, onCleanup, onMount } from "solid-js";
import { monaco, editorOptions } from "../editor/monaco";
import { settings } from "../config/store";
import { applyVariant, fileWith, job, makeVariants } from "./variants";

function CodeBox(props: { code: string; language: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const model = monaco.editor.createModel(props.code, props.language);
    const editor = monaco.editor.create(host, {
      ...editorOptions(settings()),
      model,
      readOnly: true,
      minimap: { enabled: false },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      fontSize: Math.max(11, Number(settings()["editor.fontSize"]) - 2),
      scrollBeyondLastLine: false,
      automaticLayout: true,
    });
    onCleanup(() => {
      editor.dispose();
      model.dispose();
    });
  });
  return <div class="var-code" ref={host} />;
}

export default function VariantsView() {
  const isHtml = () => job()?.language === "html";
  return (
    <div class="var-view">
      <Show when={job()} fallback={<p class="tests-empty">Выделите код или откройте файл и запустите «Три варианта» (Ctrl+Shift+P).</p>}>
        {(j) => (
          <>
            <div class="var-head">
              <span>
                ✦ <b data-no-translate>{j().instruction}</b>
              </span>
              <button class="button-quiet" onClick={() => void makeVariants(j().instruction)}>
                ↻ Ещё три
              </button>
            </div>
            <div class="var-cols">
              <For each={j().variants}>
                {(v) => (
                  <div class="var-col">
                    <div class="var-col-head">
                      <b>{v.style}</b>
                      <Show when={v.code !== null}>
                        <button class="button" onClick={() => void applyVariant(v.code!)}>
                          Выбрать
                        </button>
                      </Show>
                    </div>
                    <Show
                      when={v.code !== null}
                      fallback={<div class="var-wait">{v.error ? <span class="ext-error">{v.error}</span> : "ИИ пишет вариант…"}</div>}
                    >
                      <Show when={isHtml()}>
                        <iframe class="var-preview" sandbox="allow-scripts" srcdoc={fileWith(j(), v.code!)} title={v.style} />
                      </Show>
                      <CodeBox code={v.code!} language={j().language} />
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
