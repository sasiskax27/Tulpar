// 🔍 ИИ-ревью всего проекта: список проблем по категориям, клик — к строке,
// «Исправить с ИИ» отдаёт задачу агенту.
import { createMemo, createSignal, For, Show } from "solid-js";
import { joinPath } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { monaco } from "../editor/monaco";
import { cancelReview, reviewItems, reviewProgress, reviewProject, reviewSummary, score, type Category, type ReviewItem } from "./review";

const CATS: { id: Category | "all"; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "secret", label: "🔑 Секреты" },
  { id: "security", label: "🛡 Безопасность" },
  { id: "bug", label: "🐞 Баги" },
  { id: "perf", label: "⚡ Скорость" },
  { id: "style", label: "✨ Стиль" },
];

export default function ReviewView() {
  const [cat, setCat] = createSignal<Category | "all">("all");
  const [focus, setFocus] = createSignal("");
  const [files, setFiles] = createSignal(0);
  const [started, setStarted] = createSignal(false);
  const shown = createMemo(() => {
    const order = { error: 0, warning: 1, info: 2 };
    return reviewItems()
      .filter((i) => cat() === "all" || i.category === cat())
      .sort((a, b) => order[a.severity] - order[b.severity]);
  });
  const count = (c: Category | "all") => (c === "all" ? reviewItems().length : reviewItems().filter((i) => i.category === c).length);

  const run = async () => {
    if (!root()) {
      notify("Откройте папку проекта");
      return;
    }
    setStarted(true);
    try {
      setFiles((await reviewProject(focus().trim())) ?? 0);
    } catch (e) {
      notify(String(e), "error");
    }
  };

  const open = async (i: ReviewItem) => {
    const r = root();
    if (!r) return;
    const { openFile } = await import("../editor/tabs");
    await openFile(joinPath(r, i.file), new monaco.Range(i.line, 1, i.line, 1));
  };

  const fix = async (list: ReviewItem[]) => {
    const r = root();
    if (!r || !list.length) return;
    const { fixWithAi } = await import("../problems/problems");
    await fixWithAi(list.map((i) => ({ path: joinPath(r, i.file), line: i.line, column: 1, endLine: i.line, endColumn: 1, severity: i.severity, message: i.message, source: "ревью" })));
  };

  return (
    <div class="tool review">
      <div class="tool-row">
        <input class="tool-input grow" placeholder="На что смотреть особенно (необязательно): «безопасность входа», «утечки памяти»…" value={focus()} onInput={(e) => setFocus(e.currentTarget.value)} />
        <Show when={reviewProgress()} fallback={<button class="primary" onClick={() => void run()}>{started() ? "Проверить ещё раз" : "Проверить весь проект"}</button>}>
          <button onClick={cancelReview}>Остановить</button>
        </Show>
      </div>
      <Show when={reviewProgress()}>
        {(p) => (
          <div class="review-progress">
            <div class="fill" style={{ width: `${(p().done / Math.max(1, p().total)) * 100}%` }} />
            <span>ИИ читает проект: часть {p().done} из {p().total}</span>
          </div>
        )}
      </Show>
      <Show when={!started()}>
        <div class="tool-empty">
          ИИ прочитает весь код проекта и найдёт баги, дыры в безопасности, медленные места и забытые ключи.
          <br />
          Большой проект проверяется частями — это может занять пару минут.
        </div>
      </Show>
      <Show when={started() && !reviewProgress() && files()}>
        <div class="review-score">
          <b classList={{ ok: score(reviewItems(), files()) >= 80, err: score(reviewItems(), files()) < 50 }}>{score(reviewItems(), files())}</b>
          <span>/100 · файлов проверено: {files()}</span>
          <span class="grow" />
          <Show when={shown().length}>
            <button onClick={() => void fix(shown().slice(0, 30))}>✦ Исправить всё показанное с ИИ</button>
          </Show>
        </div>
      </Show>
      <Show when={reviewSummary()}>
        <div class="tool-ai" data-no-translate>{reviewSummary()}</div>
      </Show>
      <Show when={reviewItems().length}>
        <div class="tool-tabs">
          <For each={CATS}>
            {(c) => (
              <button classList={{ on: cat() === c.id }} onClick={() => setCat(c.id)}>
                {c.label} <span class="dim">{count(c.id)}</span>
              </button>
            )}
          </For>
        </div>
        <div class="review-list">
          <For each={shown()}>
            {(i) => (
              <div class={"review-item " + i.severity}>
                <button class="review-where" onClick={() => void open(i)} data-no-translate>
                  {i.file}:{i.line}
                </button>
                <div class="review-msg" data-no-translate>{i.message}</div>
                <button class="review-fix" onClick={() => void fix([i])} title="Агент исправит это место">✦ Исправить</button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={started() && !reviewProgress() && !reviewItems().length && files()}>
        <div class="tool-empty">Серьёзных проблем не найдено 🎉</div>
      </Show>
    </div>
  );
}
