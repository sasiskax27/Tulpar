// Панель поиска по проекту (Ctrl+Shift+F).
import { createSignal, For, Show } from "solid-js";
import {
  query, setQuery, replacement, setReplacement, caseSensitive, setCaseSensitive,
  wholeWord, setWholeWord, useRegex, setUseRegex, include, setInclude, exclude, setExclude,
  result, error, busy, runSearch, searchSoon, replaceAll, plural,
} from "./search";
import { root } from "../app/workspace";
import { openFile } from "../editor/tabs";
import { monaco } from "../editor/monaco";
import { executeCommand } from "../commands/registry";
import { baseName } from "../ipc";

let queryInput: HTMLInputElement | undefined;

/** Перейти в поле поиска, подставив текст (например, выделение из редактора). */
export function focusSearch(text?: string) {
  if (text) {
    setQuery(text);
    void runSearch();
  }
  queueMicrotask(() => {
    queryInput?.focus();
    queryInput?.select();
  });
}

function Toggle(props: { label: string; title: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      class="search-toggle"
      classList={{ on: props.on }}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.on}
      onClick={() => {
        props.set(!props.on);
        void runSearch();
      }}
    >
      {props.label}
    </button>
  );
}

export default function SearchPanel() {
  const [showReplace, setShowReplace] = createSignal(false);
  const [showFilters, setShowFilters] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());

  const toggleFile = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const summary = () => {
    const r = result();
    if (!r) return "";
    if (r.total === 0) return "Ничего не найдено";
    const files = r.files.length;
    return (
      `${r.total} ${plural(r.total, "совпадение", "совпадения", "совпадений")} в ${files} ` +
      `${plural(files, "файле", "файлах", "файлах")}` +
      (r.truncated ? " (показаны первые)" : "")
    );
  };

  return (
    <div class="search-panel">
      <div class="panel-header">
        <span>Поиск</span>
      </div>
      <Show
        when={root()}
        fallback={
          <div class="explorer-empty">
            <p>Откройте папку, чтобы искать по файлам</p>
            <button class="button" onClick={() => void executeCommand("workbench.action.files.openFolder")}>
              Открыть папку
            </button>
          </div>
        }
      >
        <div class="search-form">
          <div class="search-row">
            <button
              class="icon-button search-expand"
              aria-label={showReplace() ? "Скрыть замену" : "Показать замену"}
              aria-expanded={showReplace()}
              onClick={() => setShowReplace(!showReplace())}
            >
              {showReplace() ? "▾" : "▸"}
            </button>
            <div class="search-fields">
              <div class="search-box">
                <input
                  ref={queryInput}
                  class="search-input"
                  placeholder="Поиск"
                  aria-label="Что искать"
                  spellcheck={false}
                  value={query()}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    searchSoon();
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                />
                <Toggle label="Aa" title="Учитывать регистр" on={caseSensitive()} set={setCaseSensitive} />
                <Toggle label="ab" title="Слово целиком" on={wholeWord()} set={setWholeWord} />
                <Toggle label=".*" title="Регулярное выражение" on={useRegex()} set={setUseRegex} />
              </div>
              <Show when={showReplace()}>
                <div class="search-box">
                  <input
                    class="search-input"
                    placeholder="Заменить на"
                    aria-label="Заменить на"
                    spellcheck={false}
                    value={replacement()}
                    onInput={(e) => setReplacement(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && void replaceAll()}
                  />
                  <button
                    class="search-toggle"
                    title="Заменить всё"
                    aria-label="Заменить всё"
                    disabled={!result()?.total}
                    onClick={() => void replaceAll()}
                  >
                    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4h8M7 1.5 10 4 7 6.5M14 12H6M9 9.5 6 12l3 2.5" /></svg>
                  </button>
                </div>
              </Show>
            </div>
          </div>
          <button class="search-filters-toggle" onClick={() => setShowFilters(!showFilters())} aria-expanded={showFilters()}>
            {showFilters() ? "▾" : "▸"} Какие файлы
          </button>
          <Show when={showFilters()}>
            <label class="search-filter">
              <span>Искать в</span>
              <input
                class="search-input"
                placeholder="например: *.ts, src/**"
                spellcheck={false}
                value={include()}
                onInput={(e) => {
                  setInclude(e.currentTarget.value);
                  searchSoon();
                }}
              />
            </label>
            <label class="search-filter">
              <span>Кроме</span>
              <input
                class="search-input"
                placeholder="например: *.min.js, dist"
                spellcheck={false}
                value={exclude()}
                onInput={(e) => {
                  setExclude(e.currentTarget.value);
                  searchSoon();
                }}
              />
            </label>
          </Show>
        </div>

        <div class="search-summary" aria-live="polite">
          <Show when={error()} fallback={busy() ? "Ищу…" : summary()}>
            <span class="search-error">{error()}</span>
          </Show>
        </div>

        <div class="search-results" role="tree">
          <For each={result()?.files ?? []}>
            {(file) => {
              const dir = file.rel.includes("/") ? file.rel.slice(0, file.rel.lastIndexOf("/")) : "";
              return (
                <div role="group">
                  <button class="search-file" onClick={() => toggleFile(file.path)} aria-expanded={!collapsed().has(file.path)} title={file.rel}>
                    <span class="twistie">{collapsed().has(file.path) ? "▸" : "▾"}</span>
                    <span class="search-file-name">{baseName(file.path)}</span>
                    <span class="search-file-dir">{dir}</span>
                    <span class="search-count">{file.matches.length}</span>
                  </button>
                  <Show when={!collapsed().has(file.path)}>
                    <For each={file.matches}>
                      {(m) => (
                        <button
                          class="search-match"
                          title={`Строка ${m.line}`}
                          onClick={() => void openFile(file.path, new monaco.Range(m.line, m.startCol, m.line, m.endCol))}
                        >
                          <span class="search-line">{m.line}</span>
                          <span class="search-preview">
                            {m.before}
                            <mark classList={{ replaced: showReplace() && !!replacement() }}>{m.text}</mark>
                            <Show when={showReplace() && replacement()}>
                              <ins>{replacement()}</ins>
                            </Show>
                            {m.after}
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
