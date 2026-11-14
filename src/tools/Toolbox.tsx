// 🧰 Инструменты: всё, за чем обычно идут на сомнительные сайты, — локально.
import { createEffect, createSignal, For, on } from "solid-js";
import { notify } from "../app/notify";
import { copy } from "./ai";
import { TOOLS } from "./converters";

export default function Toolbox() {
  const [id, setId] = createSignal(TOOLS[0].id);
  const [input, setInput] = createSignal("");
  const [output, setOutput] = createSignal("");
  const [error, setError] = createSignal("");
  const tool = () => TOOLS.find((t) => t.id === id())!;

  createEffect(
    on([id, input], async () => {
      const t = tool();
      if (!input().trim() && t.id !== "uuid" && t.id !== "time") {
        setOutput("");
        setError("");
        return;
      }
      try {
        setOutput(await t.run(input()));
        setError("");
      } catch (e) {
        setError((e as Error).message ?? String(e));
      }
    }),
  );

  return (
    <div class="tool toolbox">
      <div class="toolbox-list">
        <For each={TOOLS}>
          {(t) => (
            <button classList={{ on: t.id === id() }} onClick={() => setId(t.id)}>
              {t.label}
            </button>
          )}
        </For>
      </div>
      <div class="toolbox-work">
        <div class="tool-sub">Ввод</div>
        <textarea class="tool-area mono" rows={8} value={input()} placeholder={tool().placeholder} onInput={(e) => setInput(e.currentTarget.value)} data-no-translate />
        <div class="tool-row">
          <div class="tool-sub grow">Результат</div>
          <button onClick={() => setInput(output())} disabled={!output()}>↑ В ввод</button>
          <button onClick={() => { copy(output()); notify("Скопировано"); }} disabled={!output()}>Копировать</button>
        </div>
        {error() ? <div class="tool-error">{error()}</div> : <pre class="tool-out mono" data-no-translate>{output()}</pre>}
        <div class="dim small">Всё считается на вашем компьютере — ничего не уходит в интернет.</div>
      </div>
    </div>
  );
}
