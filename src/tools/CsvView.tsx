// 📑 Таблица для CSV/TSV: сортировка, фильтр, статистика столбца, правка ячеек.
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { activePath, modelFor } from "../editor/tabs";
import { baseName } from "../ipc";
import { monaco } from "../editor/monaco";
import { columnStats, detectDelimiter, isNumeric, parseCsv, toCsv, toNumber } from "./csv";

const SHOW = 2000;

export default function CsvView() {
  const [path, setPath] = createSignal<string | null>(null);
  createEffect(() => {
    const p = activePath();
    if (p && /\.(csv|tsv)$/i.test(p)) setPath(p);
  });
  const [text, setText] = createSignal("");
  let sub: monaco.IDisposable | undefined;
  createEffect(() => {
    sub?.dispose();
    const p = path();
    const model = p ? modelFor(p) : undefined;
    setText(model?.getValue() ?? "");
    sub = model?.onDidChangeContent(() => setText(model.getValue()));
  });
  onCleanup(() => sub?.dispose());

  const [header, setHeader] = createSignal(true);
  const [filter, setFilter] = createSignal("");
  const [sort, setSort] = createSignal<{ col: number; dir: 1 | -1 } | null>(null);
  const [statCol, setStatCol] = createSignal<number | null>(null);

  const delim = createMemo(() => detectDelimiter(text(), path() ?? ""));
  const all = createMemo(() => parseCsv(text(), delim()));
  const head = createMemo(() => (header() ? all()[0] ?? [] : (all()[0] ?? []).map((_, i) => `#${i + 1}`)));
  const body = createMemo(() => {
    let rows = (header() ? all().slice(1) : all()).map((r, i) => ({ r, i: i + (header() ? 1 : 0) }));
    const f = filter().toLowerCase();
    if (f) rows = rows.filter((x) => x.r.some((v) => v.toLowerCase().includes(f)));
    const s = sort();
    if (s) {
      rows = [...rows].sort((a, b) => {
        const x = a.r[s.col] ?? "", y = b.r[s.col] ?? "";
        const n = isNumeric(x) && isNumeric(y) ? toNumber(x) - toNumber(y) : x.localeCompare(y, undefined, { numeric: true });
        return n * s.dir;
      });
    }
    return rows;
  });

  const clickHead = (c: number) => {
    setStatCol(c);
    const s = sort();
    setSort(!s || s.col !== c ? { col: c, dir: 1 } : s.dir === 1 ? { col: c, dir: -1 } : null);
  };

  const editCell = (rowIndex: number, col: number, value: string) => {
    const p = path();
    const model = p ? modelFor(p) : undefined;
    if (!model) return;
    const rows = all().map((r) => [...r]);
    while (rows[rowIndex].length <= col) rows[rowIndex].push("");
    rows[rowIndex][col] = value;
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: toCsv(rows, delim()) + (text().endsWith("\n") ? "\n" : "") }], () => null);
  };

  return (
    <div class="tool csv">
      <Show when={path()} fallback={<div class="tool-empty">Откройте файл .csv или .tsv — он появится здесь таблицей.</div>}>
        <div class="tool-row">
          <b data-no-translate>{baseName(path()!)}</b>
          <span class="dim">
            строк: {Math.max(0, all().length - (header() ? 1 : 0))} · столбцов: {head().length} · разделитель «{delim() === "\t" ? "Tab" : delim()}»
          </span>
          <span class="grow" />
          <label class="chk"><input type="checkbox" checked={header()} onChange={(e) => setHeader(e.currentTarget.checked)} /> первая строка — заголовки</label>
          <input class="tool-input" placeholder="Фильтр" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
        </div>
        <Show when={statCol() !== null}>
          <div class="dim small" data-no-translate>
            {head()[statCol()!]}: {columnStats(body().map((x) => x.r), statCol()!)}
          </div>
        </Show>
        <div class="csv-wrap">
          <table class="csv-table">
            <thead>
              <tr>
                <th class="csv-n">#</th>
                <For each={head()}>
                  {(h, c) => (
                    <th onClick={() => clickHead(c())} title="Сортировать" data-no-translate>
                      {h}
                      {sort()?.col === c() ? (sort()!.dir === 1 ? " ▲" : " ▼") : ""}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={body().slice(0, SHOW)}>
                {(x) => (
                  <tr>
                    <td class="csv-n">{x.i + 1}</td>
                    <For each={head()}>
                      {(_, c) => (
                        <td
                          classList={{ num: isNumeric(x.r[c()] ?? "") }}
                          contentEditable
                          onBlur={(e) => {
                            const v = e.currentTarget.textContent ?? "";
                            if (v !== (x.r[c()] ?? "")) editCell(x.i, c(), v);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
                          data-no-translate
                        >
                          {x.r[c()] ?? ""}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={body().length > SHOW}>
          <div class="dim small">Показаны первые {SHOW} строк из {body().length}. Используйте фильтр.</div>
        </Show>
      </Show>
    </div>
  );
}
