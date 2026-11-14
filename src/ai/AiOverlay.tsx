// Видимая часть ИИ: индикатор «ИИ работает» с отменой и окно с текстовым ответом.
import { onCleanup, onMount, Show } from "solid-js";
import { aiBusy, aiResult, cancelAi, setAiResult } from "./ai";
import { focusEditor } from "../editor/instance";

function ResultDialog(props: { title: string; text: string }) {
  const close = () => {
    setAiResult(null);
    focusEditor();
  };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });
  return (
    <div class="dialog-backdrop" onMouseDown={close}>
      <div class="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div class="dialog-header">
          <span>{props.title}</span>
          <div class="dialog-actions">
            <button class="button-quiet" onClick={() => void navigator.clipboard.writeText(props.text)}>
              Копировать
            </button>
            <button class="button-quiet" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
        <pre class="dialog-text">{props.text}</pre>
      </div>
    </div>
  );
}

export default function AiOverlay() {
  return (
    <>
      <Show when={aiBusy()}>
        <div class="ai-busy">
          <span class="ai-spinner" />
          <span>ИИ: {aiBusy()}…</span>
          <button class="button-quiet" onClick={cancelAi}>
            Отмена
          </button>
        </div>
      </Show>
      <Show when={aiResult()}>{(r) => <ResultDialog title={r().title} text={r().text} />}</Show>
    </>
  );
}
