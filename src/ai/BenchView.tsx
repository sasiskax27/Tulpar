// 🏁 Сравнение моделей: один и тот же вопрос нескольким ИИ — время, скорость,
// ответы рядом. Победителя можно назначить для чата, агента или быстрых задач.
import { createSignal, For, onMount, Show } from "solid-js";
import { core } from "../ipc";
import { settings, updateSetting } from "../config/store";
import { notify } from "../app/notify";
import { providers, type AiBase, type AiPurpose } from "./ai";
import { serviceById } from "./services";
import { initLocalAi, installed } from "./ollama";
import { Markdown } from "./ChatPanel";

interface Candidate {
  key: string;
  label: string;
  base: AiBase;
}
interface Result {
  ms: number;
  chars: number;
  text: string;
  error?: string;
}

const TASKS: [string, string][] = [
  ["Найти ошибку", "Find the bug and show the fixed code:\n\n```js\nfunction sum(list) {\n  let total = 0;\n  for (let i = 1; i <= list.length; i++) total += list[i];\n  return total;\n}\n```"],
  ["Написать функцию", "Write a Python function that checks whether a string is a valid IPv4 address. Include 3 short tests."],
  ["Объяснить код", "Explain in simple words what this does: `const unique = [...new Set(arr)].sort((a, b) => a - b);`"],
  ["SQL", "Write a SQL query: top 5 customers by total order amount in 2026, tables customers(id, name) and orders(id, customer_id, amount, created_at)."],
];

const PURPOSES: [AiPurpose, string][] = [["chat", "Чат"], ["agent", "Агент"], ["quick", "Быстрые задачи"]];

function candidates(): Candidate[] {
  const cfg = settings();
  const list: Candidate[] = [];
  const add = (id: string, model: string, baseUrl: string, apiKey: string) => {
    const d = providers[id];
    if (!d || !(model || d.model)) return;
    const m = model || d.model;
    const key = `${id}|${m}`;
    if (list.some((c) => c.key === key)) return;
    list.push({ key, label: `${serviceById(id)?.icon ?? "🤖"} ${serviceById(id)?.name ?? id} · ${m}`, base: { provider: id, model: m, baseUrl: baseUrl || d.baseUrl, apiKey } });
  };
  const cur = String(cfg["tulpar.ai.provider"]);
  if (cur !== "none") add(cur, cfg["tulpar.ai.model"], cfg["tulpar.ai.baseUrl"], cfg["tulpar.ai.apiKey"]);
  for (const [id, p] of Object.entries(cfg["tulpar.ai.profiles"] ?? {}) as [string, { model: string; baseUrl: string; apiKey: string }][]) add(id, p.model, p.baseUrl, p.apiKey);
  for (const m of installed()) add("ollama", m.name, cfg["tulpar.ai.profiles"]?.ollama?.baseUrl ?? "", "");
  return list;
}

export default function BenchView() {
  const [picked, setPicked] = createSignal<Set<string>>(new Set());
  const [prompt, setPrompt] = createSignal(TASKS[0][1]);
  const [results, setResults] = createSignal<Record<string, Result | "wait">>({});
  const [running, setRunning] = createSignal(false);
  onMount(() => {
    void initLocalAi();
    setPicked(new Set(candidates().slice(0, 3).map((c) => c.key)));
  });

  const run = async () => {
    const list = candidates().filter((c) => picked().has(c.key));
    if (!list.length) return notify("Отметьте хотя бы одну модель");
    setRunning(true);
    setResults(Object.fromEntries(list.map((c) => [c.key, "wait" as const])));
    // Облачные — параллельно; локальные — по очереди, чтобы не мешали друг другу
    const one = async (c: Candidate) => {
      const t0 = performance.now();
      try {
        const text = await core.aiComplete({ ...c.base, system: "You are a helpful coding assistant. Be concise.", prompt: prompt() });
        setResults((r) => ({ ...r, [c.key]: { ms: performance.now() - t0, chars: text.length, text } }));
      } catch (e) {
        setResults((r) => ({ ...r, [c.key]: { ms: performance.now() - t0, chars: 0, text: "", error: String(e) } }));
      }
    };
    const local = list.filter((c) => c.base.provider === "ollama");
    await Promise.all([
      ...list.filter((c) => c.base.provider !== "ollama").map(one),
      (async () => {
        for (const c of local) await one(c);
      })(),
    ]);
    setRunning(false);
  };

  const assign = (c: Candidate, purpose: AiPurpose) => {
    const cfg = settings();
    const id = c.base.provider;
    // Сохраняем выбранную модель в профиль сервиса — маршрут берёт её оттуда
    if (id !== cfg["tulpar.ai.provider"]) {
      const profiles = { ...(cfg["tulpar.ai.profiles"] ?? {}) };
      profiles[id] = { model: c.base.model, baseUrl: profiles[id]?.baseUrl ?? "", apiKey: c.base.apiKey };
      updateSetting("tulpar.ai.profiles", profiles);
    }
    const routes = { ...(cfg["tulpar.ai.routes"] ?? {}) };
    if (id === cfg["tulpar.ai.provider"] && c.base.model === cfg["tulpar.ai.model"]) delete routes[purpose];
    else routes[purpose] = id;
    updateSetting("tulpar.ai.routes", routes);
    notify(`${PURPOSES.find((p) => p[0] === purpose)![1]}: теперь ${c.label}`);
  };
  const routeOf = (purpose: AiPurpose) => settings()["tulpar.ai.routes"]?.[purpose];

  const fastest = () => {
    const r = results();
    const done = (Object.entries(r) as [string, Result | "wait"][]).filter((e): e is [string, Result] => e[1] !== "wait" && !e[1].error);
    return done.sort((a, b) => a[1].ms - b[1].ms)[0]?.[0];
  };

  return (
    <div class="tool bench">
      <div class="dim small">Задайте один вопрос нескольким ИИ и сравните, кто отвечает быстрее и лучше. Модели берутся из сервисов, которые вы уже настраивали, и из установленных в Ollama.</div>
      <div class="tool-sub">Модели</div>
      <Show when={candidates().length} fallback={<div class="tool-empty">Сначала настройте хотя бы один ИИ в настройках или магазине.</div>}>
        <div class="bench-cands">
          <For each={candidates()}>
            {(c) => (
              <label class="bench-cand" data-no-translate>
                <input
                  type="checkbox"
                  checked={picked().has(c.key)}
                  onChange={(e) => {
                    const next = new Set(picked());
                    if (e.currentTarget.checked) next.add(c.key);
                    else next.delete(c.key);
                    setPicked(next);
                  }}
                />
                {c.label}
              </label>
            )}
          </For>
        </div>
      </Show>
      <div class="tool-sub">Задание</div>
      <div class="tool-row">
        <For each={TASKS}>{([label, text]) => <button classList={{ on: prompt() === text }} onClick={() => setPrompt(text)}>{label}</button>}</For>
      </div>
      <textarea class="tool-area" rows={5} value={prompt()} onInput={(e) => setPrompt(e.currentTarget.value)} />
      <div class="tool-row">
        <button class="primary" disabled={running()} onClick={() => void run()}>{running() ? "Сравниваю…" : "🏁 Сравнить"}</button>
        <span class="dim small">
          Сейчас: <For each={PURPOSES}>{([p, label]) => <span class="bench-route">{label}: <b data-no-translate>{routeOf(p) ? serviceById(routeOf(p)!)?.name ?? routeOf(p) : "основной"}</b></span>}</For>
        </span>
      </div>
      <div class="bench-grid">
        <For each={candidates().filter((c) => results()[c.key])}>
          {(c) => {
            const r = () => results()[c.key];
            return (
              <div class="bench-card" classList={{ win: fastest() === c.key }}>
                <div class="bench-head" data-no-translate>
                  <b>{c.label}</b>
                  <Show when={fastest() === c.key}><span class="ai-tag fast">самый быстрый</span></Show>
                </div>
                <Show when={r() !== "wait"} fallback={<div class="chat-waiting">Жду ответ…</div>}>
                  {(() => {
                    const res = r() as Result;
                    return (
                      <>
                        <div class="dim small">{(res.ms / 1000).toFixed(1)} с · {res.chars} символов{res.ms > 0 && res.chars ? ` · ≈${Math.round(res.chars / 4 / (res.ms / 1000))} ток/с` : ""}</div>
                        <Show when={!res.error} fallback={<div class="tool-error">{res.error}</div>}>
                          <div class="bench-answer"><Markdown text={res.text} /></div>
                          <div class="tool-row">
                            <span class="dim small">Назначить для:</span>
                            <For each={PURPOSES}>{([p, label]) => <button class="small" onClick={() => assign(c, p)}>{label}</button>}</For>
                          </div>
                        </Show>
                      </>
                    );
                  })()}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
