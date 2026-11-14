// 📋 Доска TODO: все TODO/FIXME/HACK из проекта карточками по колонкам.
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { core } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { monaco } from "../editor/monaco";

interface Card {
  tag: string;
  text: string;
  path: string;
  rel: string;
  line: number;
  col: number;
  author?: string;
}

const COLUMNS: { tag: string; title: string; hint: string }[] = [
  { tag: "FIXME", title: "🔥 Исправить", hint: "FIXME, BUG" },
  { tag: "TODO", title: "📝 Сделать", hint: "TODO" },
  { tag: "HACK", title: "🩹 Костыли", hint: "HACK, XXX" },
  { tag: "NOTE", title: "💡 Заметки", hint: "NOTE, IDEA" },
];
const ALIAS: Record<string, string> = { BUG: "FIXME", XXX: "HACK", IDEA: "NOTE" };

export default function TodoBoard() {
  const [cards, setCards] = createSignal<Card[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [truncated, setTruncated] = createSignal(false);

  const scan = async () => {
    if (!root()) {
      notify("Откройте папку проекта");
      return;
    }
    setBusy(true);
    try {
      const res = await core.searchProject({
        query: "\\b(TODO|FIXME|HACK|BUG|XXX|NOTE|IDEA)\\b[:(]?",
        caseSensitive: true,
        wholeWord: false,
        regex: true,
        include: "",
        exclude: "*.min.js, *.lock, package-lock.json, dist, build, node_modules, target",
      });
      const out: Card[] = [];
      for (const f of res.files) {
        for (const m of f.matches) {
          const rawTag = m.text.replace(/[^A-Z]/g, "");
          const tag = ALIAS[rawTag] ?? rawTag;
          // Только в комментариях: перед меткой должен быть //, #, /*, <!--, -- или *
          if (!/(\/\/|#|\/\*|<!--|--|^\s*\*|;;)/.test(m.before)) continue;
          const text = m.after.replace(/^[\s:)-]*/, "").replace(/\s*(\*\/|-->)\s*$/, "").trim() || "(без описания)";
          const author = /^\(([^)]+)\)/.exec(m.after)?.[1];
          out.push({ tag, text, path: f.path, rel: f.rel, line: m.line, col: m.startCol, author });
        }
      }
      setCards(out);
      setTruncated(res.truncated);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  onMount(() => void scan());

  const shown = createMemo(() => {
    const f = filter().toLowerCase();
    return f ? cards().filter((c) => c.text.toLowerCase().includes(f) || c.rel.toLowerCase().includes(f)) : cards();
  });

  const open = async (c: Card) => {
    const { openFile } = await import("../editor/tabs");
    await openFile(c.path, new monaco.Range(c.line, c.col + 1, c.line, c.col + 1));
  };

  return (
    <div class="tool todo">
      <div class="tool-row">
        <input class="tool-input grow" placeholder="Фильтр по тексту или файлу" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        <span class="dim">Всего: {cards().length}</span>
        <button disabled={busy()} onClick={() => void scan()}>{busy() ? "Ищу…" : "Обновить"}</button>
      </div>
      <Show when={truncated()}>
        <div class="dim small">Показаны не все: меток слишком много.</div>
      </Show>
      <div class="todo-cols">
        <For each={COLUMNS}>
          {(col) => {
            const list = () => shown().filter((c) => c.tag === col.tag);
            return (
              <div class="todo-col">
                <div class="todo-col-head" title={col.hint}>
                  {col.title} <span class="dim">{list().length}</span>
                </div>
                <For each={list()} fallback={<div class="dim small todo-empty">Пусто 🎉</div>}>
                  {(c) => (
                    <button class="todo-card" onClick={() => void open(c)} title="Открыть в файле">
                      <div class="todo-text" data-no-translate>{c.text}</div>
                      <div class="todo-where dim" data-no-translate>
                        {c.rel}:{c.line}
                        {c.author ? ` · ${c.author}` : ""}
                      </div>
                    </button>
                  )}
                </For>
              </div>
            );
          }}
        </For>
      </div>
      <div class="dim small">Пишите в комментариях: <code>// TODO: …</code>, <code># FIXME(artur): …</code> — карточка появится здесь.</div>
    </div>
  );
}
