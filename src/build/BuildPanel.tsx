// Панель «Сборка» внизу: цель, ▶/■, прогресс, вывод с кликабельными ошибками.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { core } from "../ipc";
import { parseErrors } from "../problems/terminalErrors";
import { notify } from "../app/notify";
import { cancel, clear, current, explainFailure, license, lines, refreshTargets, reveal, runTarget, select, startedAt, status, step, targets } from "./build";
import { duration } from "./detect";

const STATUS: Record<string, string> = { idle: "", prepare: "Готовлю инструменты…", running: "Собираю…", ok: "✓ Готово", fail: "✗ Ошибка", cancelled: "■ Остановлено" };

export function LicenseDialog() {
  return (
    <Show when={license()}>
      {(answer) => (
        <div class="ob-backdrop">
          <div class="build-license">
            <h3>📱 Android SDK от Google</h3>
            <p>Чтобы собирать Android-приложения, Tulpar скачает Android SDK (платформу, build-tools и adb) с сайта Google.</p>
            <p>Для этого нужно ваше согласие с <b>лицензионным соглашением Android SDK</b>. Прочитайте его — Tulpar примет его от вашего имени только после нажатия «Принимаю».</p>
            <div class="tool-row">
              <button class="link" onClick={() => void core.openUrl("https://developer.android.com/studio/terms")}>📄 Читать соглашение</button>
              <span class="grow" />
              <button onClick={() => answer()(false)}>Не сейчас</button>
              <button class="primary" onClick={() => answer()(true)}>Принимаю</button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

export default function BuildPanel() {
  let list: HTMLDivElement | undefined;
  const [now, setNow] = createSignal(Date.now());
  const busy = () => status() === "running" || status() === "prepare";
  onMount(() => void refreshTargets());
  const timer = setInterval(() => busy() && setNow(Date.now()), 500);
  onCleanup(() => clearInterval(timer));
  createEffect(() => {
    lines();
    queueMicrotask(() => list && list.scrollHeight - list.scrollTop - list.clientHeight < 120 && (list.scrollTop = list.scrollHeight));
  });

  const openLine = async (text: string) => {
    const e = parseErrors([text])[0];
    if (!e) return;
    const { projectPath, goTo } = await import("../problems/problems");
    const path = projectPath(e.file) ?? (current() ? `${current()!.dir}/${e.file.replace(/^\.?[\\/]/, "")}` : null);
    if (!path) return notify("Файл вне проекта");
    goTo({ path, line: e.line, column: e.column, endLine: e.line, endColumn: e.column + 1, severity: e.severity, message: e.message });
  };

  return (
    <div class="build-panel">
      <LicenseDialog />
      <div class="build-bar">
        <select class="tool-input build-target" value={current()?.id ?? ""} onChange={(e) => select(e.currentTarget.value)} disabled={busy()}>
          <Show when={targets().length} fallback={<option value="">Нечего собирать — откройте проект</option>}>
            <For each={targets()}>{(t) => <option value={t.id}>{t.icon} {t.label}</option>}</For>
          </Show>
        </select>
        <button class="small" title="Найти проекты заново" onClick={() => void refreshTargets()}>⟳</button>
        <Show when={!busy()} fallback={<button class="small danger" onClick={() => void cancel()}>■ Стоп</button>}>
          <button class="primary small" disabled={!current()} onClick={() => void runTarget()}>{current()?.run ? "▶ Запустить" : "🔨 Собрать"}</button>
        </Show>
        <span class="build-status" classList={{ ok: status() === "ok", fail: status() === "fail" }}>
          {STATUS[status()]} <Show when={busy() && step()}><span class="dim">{step()}</span></Show>
          <Show when={busy() && startedAt()}><span class="dim"> · {duration(now() - startedAt())}</span></Show>
        </span>
        <span class="grow" />
        <Show when={status() === "fail"}><button class="small" onClick={() => void explainFailure()}>✦ Объяснить</button></Show>
        <Show when={status() === "ok" && current()?.artifact}><button class="small" onClick={() => void reveal(current()!)}>📁 Показать файл</button></Show>
        <button class="small" onClick={clear} disabled={busy()}>Очистить</button>
      </div>
      <Show when={busy()}><div class="build-progress"><div /></div></Show>
      <div class="build-out" ref={list} data-no-translate>
        <Show when={lines().length} fallback={<div class="dim small build-empty">Выберите, что собрать, и нажмите ▶. Ctrl+Shift+B — собрать, F6 — собрать и запустить. Чего не хватает (Java, Android SDK, Gradle, Node, Python…) Tulpar поставит сам.</div>}>
          <For each={lines()}>
            {(l) => {
              const clickable = l.err || /error|ошибка|^e: /i.test(l.text);
              return (
                <div class={`build-line ${l.kind ?? ""}`} classList={{ err: l.err && !l.kind, link: clickable }} onClick={() => clickable && void openLine(l.text)}>
                  {l.text}
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
