// Раздел «Библиотеки»: поиск по реестрам пакетов всех языков и подключение
// к проекту одной кнопкой. Видно и то, что уже подключено.
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { core, baseName, type PkgItem } from "../ipc";
import { root } from "../app/workspace";
import { notify, notifyError } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";
import { executeCommand } from "../commands/registry";
import {
  REGISTRIES,
  addDependency,
  detectManagers,
  fallbackManager,
  installedDeps,
  removeDependency,
  type Dep,
  type Manager,
  type Registry,
} from "./packages";

const INIT: Partial<Record<Registry, { hint: string; cmd?: (folder: string) => string }>> = {
  crates: { hint: "В проекте нет Cargo.toml.", cmd: () => "cargo init" },
  go: { hint: "В проекте нет go.mod.", cmd: (f) => `go mod init ${f.toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "app"}` },
  nuget: { hint: "В проекте нет .csproj.", cmd: () => "dotnet new console" },
  pub: { hint: "В проекте нет pubspec.yaml.", cmd: () => "flutter create ." },
  packagist: { hint: "В проекте нет composer.json.", cmd: () => "composer init" },
  rubygems: { hint: "В проекте нет Gemfile.", cmd: () => "bundle init" },
  maven: { hint: "В проекте нет pom.xml или build.gradle — откройте Java/Kotlin-проект Maven или Gradle." },
};

function downloads(n?: number | null): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function PackagesPanel() {
  const [managers, setManagers] = createSignal<Manager[]>([]);
  const [registry, setRegistry] = createSignal<Registry>("npm");
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<PkgItem[]>([]);
  const [deps, setDeps] = createSignal<Dep[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [dev, setDev] = createSignal(false);
  const [busy, setBusy] = createSignal<string | null>(null);
  let chosenByUser = false;

  const manager = createMemo(() => managers().find((m) => m.registry === registry()) ?? fallbackManager(registry()));
  const detected = (r: Registry) => managers().some((m) => m.registry === r);

  const refreshDeps = async () => {
    const m = manager();
    setDeps(m && root() ? await installedDeps(m) : []);
  };

  const detect = async () => {
    const list = await detectManagers();
    setManagers(list);
    if (!chosenByUser && list.length) setRegistry(list[0].registry);
    await refreshDeps();
  };
  createEffect(on(root, () => void detect()));
  createEffect(on(manager, () => void refreshDeps(), { defer: true }));

  // После команды в терминале файл проекта меняется не сразу — перечитываем несколько раз
  const later: ReturnType<typeof setTimeout>[] = [];
  const refreshSoon = () => {
    for (const ms of [2500, 7000, 15000, 30000]) later.push(setTimeout(() => void refreshDeps(), ms));
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  const search = async () => {
    const my = ++seq;
    setLoading(true);
    setError(null);
    try {
      const list = await core.pkgSearch(registry(), query());
      if (my === seq) setResults(list);
    } catch (e) {
      if (my === seq) {
        setResults([]);
        setError(String(e));
      }
    } finally {
      if (my === seq) setLoading(false);
    }
  };
  createEffect(
    on([query, registry], () => {
      clearTimeout(timer);
      timer = setTimeout(() => void search(), 400);
    }),
  );
  onCleanup(() => {
    clearTimeout(timer);
    later.forEach(clearTimeout);
  });

  const keyOf = (p: PkgItem) => p.id || p.name;
  const isAdded = (p: PkgItem) => deps().some((d) => d.name.toLowerCase() === keyOf(p).toLowerCase());

  const add = async (p: PkgItem) => {
    const m = manager();
    if (!m) return;
    setBusy(keyOf(p));
    try {
      const done = await addDependency(m, keyOf(p), p.version, dev() && m.dev);
      if (done) notify(done);
      await refreshDeps();
      refreshSoon();
    } catch (e) {
      notifyError("Не удалось добавить библиотеку", e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (d: Dep) => {
    const m = manager();
    if (!m) return;
    setBusy(d.name);
    try {
      await removeDependency(m, d.name);
      await refreshDeps();
      refreshSoon();
    } catch (e) {
      notifyError("Не удалось убрать библиотеку", e);
    } finally {
      setBusy(null);
    }
  };

  const regInfo = () => REGISTRIES.find((r) => r.id === registry())!;
  const placeholder = () =>
    registry() === "pypi"
      ? "Точное имя пакета: requests, numpy…"
      : registry() === "go"
        ? "Путь модуля: github.com/gin-gonic/gin"
        : registry() === "maven"
          ? "Например: gson, jackson, junit"
          : `Поиск в ${regInfo().label}…`;

  return (
    <div class="pkg-panel">
      <div class="panel-header">
        <span class="panel-title">Библиотеки</span>
        <div class="panel-actions">
          <button class="icon-button" title="Обновить" aria-label="Обновить" onClick={() => void detect()}>
            ↻
          </button>
        </div>
      </div>

      <div class="pkg-registries" role="tablist">
        <For each={REGISTRIES}>
          {(r) => (
            <button
              classList={{ on: registry() === r.id, found: detected(r.id) }}
              title={r.lang + (detected(r.id) ? " — есть в проекте" : "")}
              onClick={() => {
                chosenByUser = true;
                setRegistry(r.id);
              }}
            >
              {r.label}
            </button>
          )}
        </For>
      </div>

      <div class="pkg-top">
        <div class="pkg-lang">{regInfo().lang}</div>
        <Show
          when={manager()}
          fallback={
            <div class="pkg-note">
              <Show when={root()} fallback={<span>Откройте папку проекта, чтобы подключать библиотеки.</span>}>
                <span>{INIT[registry()]?.hint}</span>
                <Show when={INIT[registry()]?.cmd}>
                  <button
                    class="button-quiet"
                    onClick={() => {
                      void runInTerminal(INIT[registry()]!.cmd!(baseName(root()!)), "Библиотеки").then(() =>
                        setTimeout(() => void detect(), 4000),
                      );
                    }}
                  >
                    Создать проект ({INIT[registry()]!.cmd!(baseName(root() ?? "app"))})
                  </button>
                </Show>
              </Show>
            </div>
          }
        >
          {(m) => (
            <div class="pkg-manager">
              <span>
                Подключаю через <b>{m().label}</b>
                <Show when={m().file}> · {m().file}</Show>
                <Show when={!root() && m().id === "pip"}> (глобально)</Show>
              </span>
              <Show when={m().dev}>
                <label class="pkg-dev">
                  <input type="checkbox" checked={dev()} onChange={(e) => setDev(e.currentTarget.checked)} />
                  только для разработки
                </label>
              </Show>
            </div>
          )}
        </Show>
        <input
          class="search-input"
          placeholder={placeholder()}
          aria-label="Поиск библиотек"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          spellcheck={false}
        />
      </div>

      <div class="pkg-list">
        <Show when={deps().length}>
          <div class="ext-group">Подключено · {deps().length}</div>
          <For each={deps()}>
            {(d) => (
              <div class="pkg-dep">
                <span class="pkg-name" data-no-translate>
                  {d.name}
                </span>
                <span class="pkg-ver" data-no-translate>
                  {d.version}
                </span>
                <Show when={d.dev}>
                  <span class="pkg-tag">dev</span>
                </Show>
                <button class="icon-button" title="Убрать из проекта" aria-label="Убрать из проекта" disabled={busy() !== null} onClick={() => void remove(d)}>
                  ✕
                </button>
              </div>
            )}
          </For>
        </Show>

        <div class="ext-group">{query().trim() ? "Найдено" : "Популярные"}</div>
        <Show when={error()}>
          <p class="ext-error">Не удалось загрузить: {error()}</p>
        </Show>
        <Show when={loading() && !results().length}>
          <p class="ext-meta">Ищу…</p>
        </Show>
        <Show when={!loading() && !error() && !results().length}>
          <p class="ext-meta">{registry() === "maven" || registry() === "rubygems" ? "Введите название библиотеки." : "Ничего не найдено."}</p>
        </Show>
        <For each={results()}>
          {(p) => (
            <div class="ext-item">
              <div class="ext-body">
                <div class="ext-name" data-no-translate>
                  {p.name} <span class="ext-ver">{p.version}</span>
                </div>
                <Show when={p.description}>
                  <div class="ext-desc" data-no-translate>
                    {p.description}
                  </div>
                </Show>
                <Show when={p.downloads}>
                  <div class="ext-meta">↓ {downloads(p.downloads)}</div>
                </Show>
              </div>
              <Show when={!isAdded(p)} fallback={<span class="ext-meta">подключено</span>}>
                <button class="button" disabled={!manager() || busy() !== null} onClick={() => void add(p)}>
                  {busy() === keyOf(p) ? "…" : "Добавить"}
                </button>
              </Show>
            </div>
          )}
        </For>
        <p class="pkg-foot">
          Установка идёт в терминале, вкладка «Библиотеки». Нет нужного языка или менеджера —{" "}
          <a href="#" onClick={(e) => (e.preventDefault(), void executeCommand("workbench.action.openSettings"))}>
            Настройки → SDK и инструменты
          </a>
          .
        </p>
      </div>
    </div>
  );
}
