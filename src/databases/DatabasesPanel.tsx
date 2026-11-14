// Раздел «Базы данных»: подключения к PostgreSQL, MySQL и MongoDB, дерево
// таблиц и коллекций. SQLite-файлы открываются прямо из проводника.
import { createResource, createSignal, For, Show } from "solid-js";
import { core, type DbObject } from "../ipc";
import { notify } from "../app/notify";
import { showDb } from "../editor/side";
import { KINDS, connections, guessKind, removeConnection, safeUrl, saveConnection, type DbConnection, type DbKind } from "./databases";

function ConnectionNode(props: { c: DbConnection; onEdit: () => void }) {
  const [open, setOpen] = createSignal(false);
  const [objects, { refetch }] = createResource(
    () => (open() ? props.c : false),
    async (c) => (c.kind === "mongodb" ? core.mongoCollections(c.url) : core.dbTables(c.kind, c.url)),
  );
  const groups = () => {
    const map = new Map<string, DbObject[]>();
    for (const o of objects() ?? []) map.set(o.schema, [...(map.get(o.schema) ?? []), o]);
    return [...map.entries()];
  };
  const kindLabel = () => KINDS.find((k) => k.id === props.c.kind)?.label ?? props.c.kind;

  return (
    <div class="db-conn">
      <div class="db-conn-head" onClick={() => setOpen(!open())} title={safeUrl(props.c.url)}>
        <span class="dbg-twisty">{open() ? "▾" : "▸"}</span>
        <span class={`db-badge ${props.c.kind}`}>{props.c.kind === "postgres" ? "PG" : props.c.kind === "mysql" ? "My" : "Mo"}</span>
        <span class="db-conn-name" data-no-translate>
          {props.c.name}
        </span>
        <span class="db-conn-actions">
          <button
            class="icon-button"
            title="Новый запрос"
            aria-label="Новый запрос"
            onClick={(e) => (e.stopPropagation(), showDb(props.c.id, `${props.c.name} · запрос`))}
          >
            ⌨
          </button>
          <button class="icon-button" title="Обновить" aria-label="Обновить" onClick={(e) => (e.stopPropagation(), open() ? void refetch() : setOpen(true))}>
            ↻
          </button>
          <button class="icon-button" title="Изменить" aria-label="Изменить" onClick={(e) => (e.stopPropagation(), props.onEdit())}>
            ✎
          </button>
        </span>
      </div>
      <Show when={open()}>
        <div class="db-tree">
          <Show when={!objects.loading} fallback={<p class="ext-meta">Подключаюсь к {kindLabel()}…</p>}>
            <Show when={!objects.error} fallback={<p class="ext-error" data-no-translate>{String(objects.error)}</p>}>
              <For each={groups()} fallback={<p class="ext-meta">Таблиц нет</p>}>
                {([schema, list]) => (
                  <details class="db-schema" open={groups().length === 1}>
                    <summary data-no-translate>
                      {schema || "—"} <span class="tests-group-count">{list.length}</span>
                    </summary>
                    <For each={list}>
                      {(o) => (
                        <button class="db-object" onClick={() => showDb(props.c.id, `${props.c.name} · ${o.name}`, o.schema, o.name)}>
                          <span class="db-object-icon">{o.kind === "view" ? "◇" : o.kind === "collection" ? "{ }" : "▦"}</span>
                          <span data-no-translate>{o.name}</span>
                        </button>
                      )}
                    </For>
                  </details>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ConnectionForm(props: { initial?: DbConnection; onDone: () => void }) {
  const [kind, setKind] = createSignal<DbKind>(props.initial?.kind ?? "postgres");
  const [name, setName] = createSignal(props.initial?.name ?? "");
  const [url, setUrl] = createSignal(props.initial?.url ?? "");
  const [testing, setTesting] = createSignal(false);
  const [status, setStatus] = createSignal<{ ok: boolean; text: string } | null>(null);
  const info = () => KINDS.find((k) => k.id === kind())!;

  const conn = (): DbConnection => ({
    id: props.initial?.id ?? Math.random().toString(36).slice(2, 10),
    name: name().trim() || info().label,
    kind: kind(),
    url: url().trim(),
  });

  const test = async () => {
    const c = conn();
    if (!c.url) return;
    setTesting(true);
    setStatus(null);
    try {
      const list = c.kind === "mongodb" ? await core.mongoCollections(c.url) : await core.dbTables(c.kind, c.url);
      setStatus({ ok: true, text: `Подключено ✓ · объектов: ${list.length}` });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div class="db-form">
      <div class="db-kinds">
        <For each={KINDS}>
          {(k) => (
            <button classList={{ on: kind() === k.id }} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          )}
        </For>
      </div>
      <input class="search-input" placeholder="Название, например «Сайт — прод»" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
      <input
        class="search-input"
        placeholder={info().template}
        value={url()}
        spellcheck={false}
        onInput={(e) => {
          setUrl(e.currentTarget.value);
          const g = guessKind(e.currentTarget.value);
          if (g) setKind(g);
        }}
      />
      <p class="ext-note">{info().hint}. Строка подключения хранится только на этом компьютере и не попадает в профиль настроек.</p>
      <Show when={status()}>
        <p class={status()!.ok ? "db-ok" : "ext-error"} data-no-translate={status()!.ok ? undefined : ""}>
          {status()!.text}
        </p>
      </Show>
      <div class="db-form-buttons">
        <button
          class="button"
          disabled={!url().trim()}
          onClick={() => {
            saveConnection(conn());
            props.onDone();
          }}
        >
          Сохранить
        </button>
        <button class="button-quiet" disabled={!url().trim() || testing()} onClick={() => void test()}>
          {testing() ? "Проверяю…" : "Проверить"}
        </button>
        <button class="button-quiet" onClick={props.onDone}>
          Отмена
        </button>
        <Show when={props.initial}>
          <button
            class="button-quiet db-delete"
            onClick={() => {
              removeConnection(props.initial!.id);
              notify("Подключение удалено");
              props.onDone();
            }}
          >
            Удалить
          </button>
        </Show>
      </div>
    </div>
  );
}

export default function DatabasesPanel() {
  const [form, setForm] = createSignal<{ initial?: DbConnection } | null>(null);
  return (
    <div class="pkg-panel">
      <div class="panel-header">
        <span class="panel-title">Базы данных</span>
        <div class="panel-actions">
          <button class="icon-button" title="Новое подключение" aria-label="Новое подключение" onClick={() => setForm({})}>
            ＋
          </button>
        </div>
      </div>
      <div class="pkg-list">
        <Show when={form()}>{(f) => <ConnectionForm initial={f().initial} onDone={() => setForm(null)} />}</Show>
        <For each={connections()}>{(c) => <ConnectionNode c={c} onEdit={() => setForm({ initial: c })} />}</For>
        <Show when={!connections().length && !form()}>
          <div class="tests-empty">
            <p>Подключитесь к PostgreSQL, MySQL или MongoDB — смотрите таблицы и выполняйте запросы прямо в Tulpar.</p>
            <button class="button" onClick={() => setForm({})}>
              ＋ Подключить базу
            </button>
            <p class="ext-note">Файлы SQLite (.db, .sqlite) открываются просто кликом в проводнике.</p>
          </div>
        </Show>
      </div>
    </div>
  );
}
