// 🎞 Flight Recorder и Recall: лента событий и поиск по всему, что было в проекте.
import { createMemo, createSignal, For, Show } from "solid-js";
import { ICONS, clearFlight, events, log, type FlightEvent } from "./flight";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { monaco } from "../editor/monaco";
import { askInput } from "../app/InputBox";

interface Hit {
  path: string;
  added?: number;
  removed?: number;
  line: string;
  lineNo: number;
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

export default function FlightView() {
  const [q, setQ] = createSignal("");
  const [hits, setHits] = createSignal<Hit[] | null>(null);
  const [searching, setSearching] = createSignal(false);

  const shown = createMemo(() => {
    const f = q().trim().toLowerCase();
    const list = events().slice().reverse();
    return f ? list.filter((e) => e.text.toLowerCase().includes(f)) : list.slice(0, 400);
  });
  const groups = createMemo(() => {
    const out: { day: string; items: FlightEvent[] }[] = [];
    for (const e of shown()) {
      const d = day(e.t);
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  });

  /** Recall: где в истории файлов появлялся и исчезал текст. */
  const recall = async () => {
    const query = q().trim();
    if (!query) return;
    setSearching(true);
    try {
      const { allSnapshots } = await import("../tools/history");
      const byPath = new Map<string, { time: number; content: string }[]>();
      for (const s of await allSnapshots()) {
        if (root() && !s.path.toLowerCase().startsWith(root()!.toLowerCase())) continue;
        const list = byPath.get(s.path) ?? [];
        list.push(s);
        byPath.set(s.path, list);
      }
      const out: Hit[] = [];
      const lq = query.toLowerCase();
      for (const [path, list] of byPath) {
        list.sort((a, b) => a.time - b.time);
        let had = false;
        let added: number | undefined;
        let removed: number | undefined;
        let line = "";
        let lineNo = 0;
        for (const s of list) {
          const has = s.content.toLowerCase().includes(lq);
          if (has && !had) {
            added = s.time;
            const lines = s.content.split("\n");
            lineNo = lines.findIndex((l) => l.toLowerCase().includes(lq)) + 1;
            line = lines[lineNo - 1]?.trim() ?? "";
          }
          if (!has && had) removed = s.time;
          had = has;
        }
        if (added) out.push({ path, added, removed: had ? undefined : removed, line, lineNo });
      }
      setHits(out.sort((a, b) => (b.removed ?? b.added ?? 0) - (a.removed ?? a.added ?? 0)));
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setSearching(false);
    }
  };

  const openHit = async (h: Hit) => {
    const { openFile } = await import("../editor/tabs");
    await openFile(h.path, h.lineNo ? new monaco.Range(h.lineNo, 1, h.lineNo, 1) : undefined);
  };

  const rel = (p: string) => (root() && p.startsWith(root()!) ? p.slice(root()!.length + 1).replace(/\\/g, "/") : p);

  const note = async () => {
    const text = await askInput({ title: "Заметка в ленту", placeholder: "Например: «выкатили на сервер», «нашли причину бага с входом»" });
    if (text) log("note", text);
  };

  return (
    <div class="tool flight">
      <div class="tool-row">
        <input
          class="tool-input grow"
          placeholder="Recall: «где мы исправляли ошибку входа?», имя функции, текст ошибки…"
          value={q()}
          onInput={(e) => { setQ(e.currentTarget.value); setHits(null); }}
          onKeyDown={(e) => e.key === "Enter" && void recall()}
        />
        <button disabled={!q().trim() || searching()} onClick={() => void recall()}>{searching() ? "Ищу…" : "🔎 Искать в истории файлов"}</button>
        <button onClick={() => void note()}>+ Заметка</button>
      </div>
      <Show when={hits()}>
        <div class="tool-sub">История файлов</div>
        <Show when={hits()!.length} fallback={<div class="dim small">В сохранённых версиях файлов такого текста не было.</div>}>
          <div class="recall-hits">
            <For each={hits()}>
              {(h) => (
                <button class="recall-hit" onClick={() => void openHit(h)}>
                  <b data-no-translate>{rel(h.path)}</b>
                  <span class="dim small">
                    появилось {new Date(h.added!).toLocaleString()}
                    {h.removed ? ` · убрано ${new Date(h.removed).toLocaleString()}` : " · есть сейчас"}
                  </span>
                  <code data-no-translate>{h.line}</code>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <div class="tool-sub">Лента событий</div>
      <Show when={groups().length} fallback={<div class="tool-empty">Здесь появятся сохранения, коммиты, тесты, ошибки и работа ИИ — по времени.</div>}>
        <div class="flight-list">
          <For each={groups()}>
            {(g) => (
              <>
                <div class="flight-day">{g.day}</div>
                <For each={g.items}>
                  {(e) => (
                    <div class="flight-item" classList={{ bad: e.ok === false, good: e.ok === true }}>
                      <span class="flight-time">{time(e.t)}</span>
                      <span class="flight-icon">{ICONS[e.kind]}</span>
                      <span class="flight-text" data-no-translate>{e.text}</span>
                    </div>
                  )}
                </For>
              </>
            )}
          </For>
        </div>
        <button class="link small" onClick={clearFlight}>Очистить ленту</button>
      </Show>
    </div>
  );
}
