// Просмотр базы SQLite: таблицы слева, данные справа, поле для SQL.
import { createResource, createSignal, For, Show } from "solid-js";
import { core, type SqliteResult } from "../ipc";

const PAGE = 200;

export default function SqliteView(props: { path: string }) {
  const [tables, { refetch }] = createResource(() => props.path, (p) => core.sqliteTables(p));
  const [active, setActive] = createSignal<string | null>(null);
  const [sql, setSql] = createSignal("");
  const [result, setResult] = createSignal<SqliteResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [write, setWrite] = createSignal(false);
  const [offset, setOffset] = createSignal(0);

  const quote = (n: string) => `"${n.replace(/"/g, '""')}"`;

  const run = async (query = sql()) => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await core.sqliteQuery(props.path, query, write());
      setResult(r);
      if (r.changes !== null) void refetch();
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const openTable = (name: string, from = 0) => {
    setActive(name);
    setOffset(from);
    const q = `SELECT * FROM ${quote(name)} LIMIT ${PAGE} OFFSET ${from}`;
    setSql(q);
    void run(q);
  };

  const activeInfo = () => tables()?.find((t) => t.name === active());

  return (
    <div class="sqlite-view">
      <div class="sqlite-tables">
        <div class="ext-group">Таблицы</div>
        <Show when={!tables.error} fallback={<p class="ext-error">{String(tables.error)}</p>}>
          <For each={tables() ?? []} fallback={<p class="ext-meta">{tables.loading ? "Загружаю…" : "Таблиц нет"}</p>}>
            {(t) => (
              <button
                class="sqlite-table"
                classList={{ on: active() === t.name }}
                title={t.columns.map((c) => `${c.name} ${c.type}${c.pk ? " PK" : ""}`).join("\n")}
                onClick={() => openTable(t.name)}
              >
                <span class="sqlite-table-name" data-no-translate>
                  {t.kind === "view" ? "◇ " : ""}
                  {t.name}
                </span>
                <span class="sqlite-table-rows">{t.rows ?? "?"}</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="sqlite-main">
        <div class="sqlite-query">
          <textarea
            class="sqlite-sql"
            placeholder="SELECT * FROM таблица WHERE … — Ctrl+Enter"
            spellcheck={false}
            value={sql()}
            onInput={(e) => setSql(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void run();
              }
            }}
          />
          <div class="sqlite-query-row">
            <button class="button" disabled={busy()} onClick={() => void run()}>
              {busy() ? "…" : "▶ Выполнить"}
            </button>
            <label class="sqlite-write" title="Без этой галочки база открывается только для чтения: INSERT, UPDATE и DELETE не сработают">
              <input type="checkbox" checked={write()} onChange={(e) => setWrite(e.currentTarget.checked)} />
              Разрешить изменения
            </label>
            <Show when={result()}>
              {(r) => (
                <span class="sqlite-stats">
                  {r().changes !== null ? `изменено строк: ${r().changes}` : `строк: ${r().rows.length}${r().truncated ? "+" : ""}`} · {r().millis} мс
                </span>
              )}
            </Show>
          </div>
        </div>

        <Show when={error()}>
          <p class="sqlite-error" data-no-translate>
            {error()}
          </p>
        </Show>

        <Show when={result() && result()!.columns.length}>
          <div class="sqlite-grid-wrap">
            <table class="sqlite-grid">
              <thead>
                <tr>
                  <For each={result()!.columns}>
                    {(c) => {
                      const col = () => activeInfo()?.columns.find((x) => x.name === c);
                      return (
                        <th title={col()?.type} data-no-translate>
                          {col()?.pk ? "🔑 " : ""}
                          {c}
                        </th>
                      );
                    }}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={result()!.rows}>
                  {(row) => (
                    <tr>
                      <For each={row}>
                        {(v) => (
                          <td classList={{ null: v === null, num: typeof v === "number" }} title={v === null ? "NULL" : String(v)} data-no-translate>
                            {v === null ? "NULL" : String(v)}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <Show when={active() && activeInfo() && (activeInfo()!.rows ?? 0) > PAGE}>
            <div class="sqlite-pager">
              <button class="button-quiet" disabled={offset() === 0} onClick={() => openTable(active()!, Math.max(0, offset() - PAGE))}>
                ← Назад
              </button>
              <span>
                {offset() + 1}–{Math.min(offset() + PAGE, activeInfo()!.rows ?? 0)} из {activeInfo()!.rows}
              </span>
              <button
                class="button-quiet"
                disabled={offset() + PAGE >= (activeInfo()!.rows ?? 0)}
                onClick={() => openTable(active()!, offset() + PAGE)}
              >
                Дальше →
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
