// 📜 Логи: системный журнал или любой лог-файл, фильтр по уровню, поиск,
// «следить» за новыми строками и разбор ошибок ИИ одной кнопкой.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { core, baseName } from "../ipc";
import { open } from "../i18n/dialog";
import { notifyError } from "../app/notify";
import { askAi } from "../tools/ai";
import { parseLogText, parseSyslog, type LogLine } from "./parse";

type Source = { kind: "system" } | { kind: "file"; path: string };
const LEVELS: [LogLine["level"], string][] = [["error", "Ошибки"], ["warn", "Предупреждения"], ["info", "Инфо"], ["debug", "Отладка"]];

export default function LogsView() {
  const [source, setSource] = createSignal<Source | null>(null);
  const [lines, setLines] = createSignal<LogLine[]>([]);
  const [levels, setLevels] = createSignal<Set<string>>(new Set(["error", "warn", "info"]));
  const [q, setQ] = createSignal("");
  const [follow, setFollow] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [answer, setAnswer] = createSignal("");
  const [thinking, setThinking] = createSignal(false);

  const load = async (src = source()) => {
    if (!src) return;
    setBusy(true);
    try {
      setLines(src.kind === "system" ? parseSyslog(await core.sysQuery("syslog")) : parseLogText(await core.sysTail(src.path)));
    } catch (e) {
      notifyError("Логи", e);
    } finally {
      setBusy(false);
    }
  };
  const timer = setInterval(() => follow() && !busy() && void load(), 2500);
  onCleanup(() => clearInterval(timer));

  const openFile = async () => {
    const path = await open({ title: "Файл журнала", filters: [{ name: "Журналы", extensions: ["log", "txt", "out", "err", "jsonl"] }] });
    if (typeof path !== "string") return;
    const src: Source = { kind: "file", path };
    setSource(src);
    void load(src);
  };
  const openSystem = () => {
    const src: Source = { kind: "system" };
    setSource(src);
    void load(src);
  };

  const shown = createMemo(() => {
    const needle = q().toLowerCase();
    const on = levels();
    return lines().filter((l) => on.has(l.level) && (!needle || (l.text + l.source).toLowerCase().includes(needle))).slice(-1500);
  });
  const counts = createMemo(() => {
    const c: Record<string, number> = {};
    for (const l of lines()) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  });
  const toggle = (lv: string) => {
    const next = new Set(levels());
    if (next.has(lv)) next.delete(lv);
    else next.add(lv);
    setLevels(next);
  };

  const explain = async () => {
    const errors = lines().filter((l) => l.level === "error").slice(-40);
    const sample = (errors.length ? errors : lines().slice(-60)).map((l) => `${l.time} ${l.source} ${l.text}`.trim()).join("\n");
    if (!sample) return;
    setThinking(true);
    setAnswer("");
    try {
      const a = await askAi(
        "You analyze log files for a developer. Group the errors by cause, explain each cause in plain words, and give concrete steps to fix it. Ignore harmless noise. Be brief.",
        `Log lines:\n${sample.slice(0, 20_000)}`,
      );
      setAnswer(a ?? "");
    } catch (e) {
      notifyError("ИИ", e);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div class="tool logs">
      <div class="tool-row">
        <button classList={{ primary: source()?.kind !== "system" }} onClick={openSystem}>🖥 Системный журнал</button>
        <button onClick={() => void openFile()}>📄 Открыть лог-файл…</button>
        <Show when={source()}>
          <span class="dim small" data-no-translate>{source()!.kind === "file" ? baseName((source() as { path: string }).path) : ""}</span>
          <span class="grow" />
          <label class="small"><input type="checkbox" checked={follow()} onChange={(e) => setFollow(e.currentTarget.checked)} /> следить</label>
          <button onClick={() => void load()} disabled={busy()}>⟳</button>
        </Show>
      </div>
      <Show when={source()} fallback={<div class="tool-empty">Выберите системный журнал или лог-файл своего проекта — ошибки подсветятся, а ИИ объяснит, что сломалось.</div>}>
        <div class="tool-row">
          <For each={LEVELS}>
            {([lv, label]) => (
              <button class={`log-chip ${lv}`} classList={{ on: levels().has(lv) }} onClick={() => toggle(lv)}>
                {label} {counts()[lv] ?? 0}
              </button>
            )}
          </For>
          <input class="tool-input grow" placeholder="Поиск по журналу" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="primary" disabled={thinking() || !lines().length} onClick={() => void explain()}>{thinking() ? "ИИ разбирает…" : "✨ Объяснить ошибки"}</button>
        </div>
        <Show when={answer()}>
          <div class="tool-ai">{answer()}</div>
        </Show>
        <div class="log-list" data-no-translate>
          <For each={shown()}>
            {(l) => (
              <div class={`log-line ${l.level}`}>
                <span class="log-time">{l.time}</span>
                <Show when={l.source}><span class="log-src">{l.source}</span></Show>
                <span class="log-text">{l.text}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
