// Раздел «Расширения»: темы и сниппеты VS Code из открытого каталога Open VSX.
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { core, type ExtSearchItem } from "../ipc";
import { settings, updateSetting } from "../config/store";
import { extBusy, extThemes, installedExtensions, installExtension, uninstallExtension } from "./extensions";

type Category = "Themes" | "Snippets";

function downloads(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function ExtensionsPanel() {
  const [query, setQuery] = createSignal("");
  const [category, setCategory] = createSignal<Category>("Themes");
  const [results, setResults] = createSignal<ExtSearchItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const search = async () => {
    const my = ++seq;
    setLoading(true);
    setError(null);
    try {
      const list = await core.extSearch(query(), category());
      if (my === seq) setResults(list);
    } catch (e) {
      if (my === seq) setError(String(e));
    } finally {
      if (my === seq) setLoading(false);
    }
  };

  createEffect(
    on([query, category], () => {
      clearTimeout(timer);
      timer = setTimeout(() => void search(), 350);
    }),
  );
  onCleanup(() => clearTimeout(timer));

  const isInstalled = (r: ExtSearchItem) => installedExtensions().some((e) => e.id === `${r.namespace}.${r.name}`);
  const current = () => String(settings()["workbench.colorTheme"]);

  return (
    <div class="ext-panel">
      <div class="panel-header">
        <span class="panel-title">Расширения</span>
      </div>
      <div class="ext-search">
        <input
          class="search-input"
          placeholder="Поиск в Open VSX: dracula, one dark, material…"
          aria-label="Поиск расширений"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          spellcheck={false}
        />
        <div class="ext-tabs" role="tablist">
          <button classList={{ on: category() === "Themes" }} onClick={() => setCategory("Themes")}>
            Темы
          </button>
          <button classList={{ on: category() === "Snippets" }} onClick={() => setCategory("Snippets")}>
            Сниппеты
          </button>
        </div>
        <p class="ext-note">Из расширений VS Code работают темы и сниппеты. Остальное (код расширений) в Tulpar не запускается — так быстрее и безопаснее.</p>
      </div>

      <div class="ext-list">
        <Show when={installedExtensions().length}>
          <div class="ext-group">Установлено</div>
          <For each={installedExtensions()}>
            {(e) => (
              <div class="ext-item installed">
                <div class="ext-body">
                  <div class="ext-name">
                    {e.displayName} <span class="ext-ver">{e.version}</span>
                  </div>
                  <div class="ext-themes">
                    <For each={[...extThemes().values()].filter((t) => t.ext === e.id)}>
                      {(t) => (
                        <button
                          class="ext-theme"
                          classList={{ on: current() === t.id }}
                          title="Включить тему"
                          onClick={() => updateSetting("workbench.colorTheme", t.id)}
                        >
                          <span class="ext-swatch" style={{ background: t.palette.code, "border-color": t.palette.accent }}>
                            <i style={{ background: t.palette.kw }} />
                            <i style={{ background: t.palette.str }} />
                          </span>
                          {t.label}
                        </button>
                      )}
                    </For>
                    <Show when={e.snippets.length}>
                      <span class="ext-meta">Сниппеты: {e.snippets.map((s) => s.language).join(", ")}</span>
                    </Show>
                  </div>
                </div>
                <button class="button-quiet" disabled={extBusy() === e.id} onClick={() => void uninstallExtension(e.id)}>
                  Удалить
                </button>
              </div>
            )}
          </For>
        </Show>

        <div class="ext-group">{query().trim() ? "Найдено" : category() === "Themes" ? "Популярные темы" : "Популярные сниппеты"}</div>
        <Show when={error()}>
          <p class="ext-error">Не удалось загрузить каталог: {error()}</p>
        </Show>
        <Show when={loading() && !results().length}>
          <p class="ext-meta">Загружаю…</p>
        </Show>
        <For each={results()}>
          {(r) => (
            <div class="ext-item">
              <Show when={r.icon} fallback={<div class="ext-icon ext-icon-empty">{(r.displayName || r.name).slice(0, 1)}</div>}>
                <img class="ext-icon" src={r.icon} alt="" loading="lazy" />
              </Show>
              <div class="ext-body">
                <div class="ext-name" data-no-translate>
                  {r.displayName || r.name}
                </div>
                <div class="ext-desc" data-no-translate>
                  {r.description}
                </div>
                <div class="ext-meta">
                  <span data-no-translate>{r.namespace}</span>
                  <Show when={r.downloads}> · ↓ {downloads(r.downloads)}</Show>
                </div>
              </div>
              <Show
                when={!isInstalled(r)}
                fallback={<span class="ext-meta">установлено</span>}
              >
                <button class="button" disabled={extBusy() !== null} onClick={() => void installExtension(r.namespace, r.name)}>
                  {extBusy() === `${r.namespace}.${r.name}` ? "Ставлю…" : "Установить"}
                </button>
              </Show>
            </div>
          )}
        </For>
        <Show when={!loading() && !error() && !results().length}>
          <p class="ext-meta">Ничего не найдено.</p>
        </Show>
      </div>
    </div>
  );
}
