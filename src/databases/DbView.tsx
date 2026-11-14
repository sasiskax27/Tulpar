// Таблица серверной базы справа: SQL-запрос (PostgreSQL, MySQL) или фильтр
// документов (MongoDB) и результат таблицей.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { core, type SqliteResult } from "../ipc";
import { connectionById, quoteIdent, isWriteSql } from "./databases";

export default function DbView(props: { connId: string; schema?: string; table?: string }) {
  const conn = () => connectionById(props.connId);
  const isMongo = () => conn()?.kind === "mongodb";
  const [text, setText] = createSignal("");
  const [result, setResult] = createSignal<SqliteResult | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [allowWrite, setAllowWrite] = createSignal(false);

  const run = async (query = text()) => {
    const c = conn();
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      if (c.kind === "mongodb") {
        setResult(await core.mongoFind(c.url, props.schema ?? "", props.table ?? "", query, 200));
      } else {
        if (isWriteSql(query) && !allowWrite()) {
          setError("Это изменяющий запрос. Включите «Разрешить изменения», если уверены.");
          return;
        }
        setResult(await core.dbQuery(c.kind, c.url, query));
      }
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  createEffect(
    on(
      () => [props.connId, props.schema, props.table],
      () => {
        const c = conn();
        if (!c) return;
        setResult(null);
        setError(null);
        if (c.kind === "mongodb") {
          setText("{}");
          if (props.table) void run("{}");
        } else if (props.table) {
          const name = c.kind === "postgres" && props.schema && props.schema !== "public"
            ? `${quoteIdent(c.kind, props.schema)}.${quoteIdent(c.kind, props.table)}`
            : quoteIdent(c.kind, props.table);
          const q = `SELECT * FROM ${name} LIMIT 200`;
          setText(q);
          void run(q);
        } else setText("");
      },
    ),
  );

  return (
    <div class="sqlite-main db-view">
      <Show when={conn()} fallback={<p class="sqlite-error">Подключение удалено</p>}>
        <div class="sqlite-query">
          <textarea
            class="sqlite-sql"
            spellcheck={false}
            value={text()}
            placeholder={isMongo() ? '{ "age": { "$gt": 18 } } — Ctrl+Enter' : "SELECT … — Ctrl+Enter"}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void run();
              }
            }}
          />
          <div class="sqlite-query-row">
            <button class="button" disabled={busy()} onClick={() => void run()}>
              {busy() ? "…" : isMongo() ? "▶ Найти" : "▶ Выполнить"}
            </button>
            <Show when={!isMongo()}>
              <label class="sqlite-write" title="Защита от случайных UPDATE, DELETE, DROP">
                <input type="checkbox" checked={allowWrite()} onChange={(e) => setAllowWrite(e.currentTarget.checked)} />
                Разрешить изменения
              </label>
            </Show>
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
                  <For each={result()!.columns}>{(c) => <th data-no-translate>{c}</th>}</For>
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
        </Show>
      </Show>
    </div>
  );
}
