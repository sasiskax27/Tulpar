// 🛰 Command Center: всё важное на одном экране — компьютер, процессы, порты,
// ошибки, ИИ, серверы, Docker, службы и виртуальные машины. Виджеты можно
// прятать и показывать (кнопка «Настроить»).
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { core, baseName } from "../ipc";
import { root } from "../app/workspace";
import { settings } from "../config/store";
import { formatBytes, formatUptime, parseOverview, parsePorts, parseProcesses, type Overview, type Port, type Proc } from "./parse";
import { serviceById, testConnection } from "../ai/services";

type WidgetId = "system" | "procs" | "ports" | "problems" | "ai" | "servers" | "docker" | "services" | "vms";
const WIDGETS: [WidgetId, string][] = [
  ["system", "Компьютер"], ["procs", "Тяжёлые процессы"], ["ports", "Порты"], ["problems", "Ошибки в коде"],
  ["ai", "ИИ"], ["servers", "Серверы"], ["docker", "Docker"], ["services", "Службы магазина"], ["vms", "Виртуальные машины"],
];
const KEY = "tulpar.cc.hidden";

const openTool = (id: string) => void import("../editor/side").then((m) => m.showTool(id as never));

function Widget(props: { title: string; icon: string; onOpen?: () => void; children?: JSX.Element }) {
  return (
    <section class="cc-widget">
      <header class="cc-head">
        <span>{props.icon}</span>
        <b>{props.title}</b>
        <span class="grow" />
        <Show when={props.onOpen}><button class="link small" onClick={props.onOpen}>Открыть →</button></Show>
      </header>
      <div class="cc-body">{props.children}</div>
    </section>
  );
}

function Meter(props: { value: number; label: string }) {
  const pct = () => Math.max(0, Math.min(100, props.value));
  return (
    <div class="cc-meter">
      <div class="cc-meter-top"><span>{props.label}</span><b>{Math.round(pct())}%</b></div>
      <div class="cc-meter-bar" classList={{ hot: pct() > 85, warm: pct() > 65 && pct() <= 85 }}><div style={{ width: `${pct()}%` }} /></div>
    </div>
  );
}

function Spark(props: { values: number[] }) {
  const points = () => props.values.map((v, i) => `${(i / Math.max(1, props.values.length - 1)) * 100},${30 - (v / 100) * 28}`).join(" ");
  return (
    <svg class="cc-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points()} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

export default function CommandCenter() {
  const [hidden, setHidden] = createSignal<Set<string>>(new Set((() => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } })()));
  const [editing, setEditing] = createSignal(false);
  const [ov, setOv] = createSignal<Overview | null>(null);
  const [cpuHist, setCpuHist] = createSignal<number[]>([]);
  const [procs, setProcs] = createSignal<Proc[]>([]);
  const [ports, setPorts] = createSignal<Port[]>([]);
  const [docker, setDocker] = createSignal<{ state: string; running: number; total: number } | null>(null);
  const [problems, setProblems] = createSignal({ errors: 0, warnings: 0 });
  const [running, setRunning] = createSignal<Record<string, boolean>>({});
  const [vmRun, setVmRun] = createSignal(0);
  const [servers, setServers] = createSignal<{ id: string; name: string; host: string }[]>([]);

  const show = (id: WidgetId) => !hidden().has(id);
  const toggle = (id: string) => {
    const next = new Set(hidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const fast = async () => {
    if (show("system")) {
      const o = await core.sysQuery("overview").then(parseOverview).catch(() => null);
      setOv(o);
      if (o?.cpu != null) setCpuHist((h) => [...h.slice(-39), o.cpu!]);
    }
    void import("../problems/problems").then((p) => setProblems(p.counts()));
    void import("../store/actions").then(async (a) => { await a.refreshRunning(); setRunning({ ...a.running() }); }).catch(() => {});
    void import("../vm/vms").then(async (v) => { await v.refreshStatus(); setVmRun(Object.values(v.status()).filter((s) => s === "running").length); });
  };
  const slow = async () => {
    if (show("procs") || show("ports")) {
      const p = await core.sysQuery("processes").then(parseProcesses).catch(() => [] as Proc[]);
      setProcs(p);
      if (show("ports")) setPorts(await core.sysQuery("ports").then((r) => parsePorts(r, p)).catch(() => []));
    }
    if (show("docker")) {
      const d = await import("../docker/docker");
      const st = await d.dockerStatus().catch(() => "missing" as const);
      if (st !== "ok") setDocker({ state: st, running: 0, total: 0 });
      else {
        const list = await d.containers().catch(() => []);
        setDocker({ state: st, running: list.filter((c) => c.State === "running").length, total: list.length });
      }
    }
    const s = await import("../servers/servers");
    setServers(s.servers().map((x) => ({ id: x.id, name: x.name, host: x.host })));
  };
  onMount(() => {
    void fast();
    void slow();
  });
  const t1 = setInterval(() => void fast(), 3000);
  const t2 = setInterval(() => void slow(), 15000);
  onCleanup(() => { clearInterval(t1); clearInterval(t2); });

  const ai = () => {
    const cfg = settings();
    const id = String(cfg["tulpar.ai.provider"]);
    return { id, name: serviceById(id)?.name ?? "выключен", icon: serviceById(id)?.icon ?? "💤", model: cfg["tulpar.ai.model"], routes: cfg["tulpar.ai.routes"] ?? {} };
  };
  const runningServices = () => Object.entries(running()).filter(([, v]) => v).map(([k]) => k);
  const topProcs = () => [...procs()].sort((a, b) => b.memMb - a.memMb).slice(0, 6);

  return (
    <div class="tool cc">
      <header class="store-hero">
        <div class="store-hero-icon">🛰</div>
        <div class="store-hero-text">
          <b>Command Center</b>
          <span class="dim small">{root() ? `Проект: ${baseName(root()!)}` : "Проект не открыт"} · обновляется само</span>
        </div>
        <button onClick={() => setEditing(!editing())}>{editing() ? "Готово" : "⚙ Настроить"}</button>
      </header>
      <Show when={editing()}>
        <div class="tool-row cc-edit">
          <For each={WIDGETS}>{([id, label]) => <label class="small"><input type="checkbox" checked={!hidden().has(id)} onChange={() => toggle(id)} /> {label}</label>}</For>
        </div>
      </Show>

      <div class="cc-grid">
        <Show when={show("system")}>
          <Widget title="Компьютер" icon="💻">
            <Show when={ov()} fallback={<div class="dim small">Собираю данные…</div>}>
              {(o) => (
                <>
                  <Show when={o().cpu != null}><Meter label={`Процессор · ${o().cores} ядер`} value={o().cpu!} /></Show>
                  <Spark values={cpuHist()} />
                  <Meter label={`Память · ${formatBytes(o().memUsed)} из ${formatBytes(o().memTotal)}`} value={o().memTotal ? (o().memUsed / o().memTotal) * 100 : 0} />
                  <Show when={o().uptimeSec}><div class="dim small">Без перезагрузки: {formatUptime(o().uptimeSec)}</div></Show>
                </>
              )}
            </Show>
          </Widget>
        </Show>

        <Show when={show("procs")}>
          <Widget title="Тяжёлые процессы" icon="⚙" onOpen={() => openTool("processes")}>
            <For each={topProcs()} fallback={<div class="dim small">…</div>}>
              {(p) => <div class="cc-row" data-no-translate><span class="grow">{p.name}</span><span class="dim">{p.memMb} МБ</span></div>}
            </For>
          </Widget>
        </Show>

        <Show when={show("ports")}>
          <Widget title={`Порты · ${ports().length}`} icon="🔌" onOpen={() => openTool("processes")}>
            <For each={ports().slice(0, 7)} fallback={<div class="dim small">Никто не слушает порты</div>}>
              {(p) => <div class="cc-row" data-no-translate><b>{p.port}</b><span class="grow dim">{p.process}</span></div>}
            </For>
          </Widget>
        </Show>

        <Show when={show("problems")}>
          <Widget title="Ошибки в коде" icon="🐞" onOpen={() => void import("../problems/problems").then((p) => p.showProblems())}>
            <div class="cc-big">
              <span classList={{ bad: problems().errors > 0 }}>✗ {problems().errors}</span>
              <span classList={{ warn: problems().warnings > 0 }}>⚠ {problems().warnings}</span>
            </div>
            <div class="dim small">{problems().errors ? "Откройте список и нажмите «Исправить с ИИ»" : "Ошибок нет — так держать"}</div>
          </Widget>
        </Show>

        <Show when={show("ai")}>
          <Widget title="ИИ" icon="✨" onOpen={() => openTool("store")}>
            <div class="cc-row"><span>{ai().icon}</span><b class="grow" data-no-translate>{ai().name}</b></div>
            <div class="dim small" data-no-translate>{ai().model || "модель не выбрана"}</div>
            <Show when={Object.keys(ai().routes).length}>
              <div class="dim small">Маршруты: {Object.entries(ai().routes).map(([k, v]) => `${k === "chat" ? "чат" : k === "agent" ? "агент" : "быстрые"} → ${serviceById(String(v))?.name ?? v}`).join(", ")}</div>
            </Show>
            <div class="tool-row">
              <button class="small" onClick={() => void testConnection()}>Проверить связь</button>
              <button class="small" onClick={() => openTool("bench")}>🏁 Сравнить модели</button>
            </div>
          </Widget>
        </Show>

        <Show when={show("servers")}>
          <Widget title={`Серверы · ${servers().length}`} icon="🖧" onOpen={() => openTool("servers")}>
            <For each={servers()} fallback={<div class="dim small">Серверов нет. Добавьте в разделе «Серверы».</div>}>
              {(s) => <div class="cc-row" data-no-translate><span class="grow">{s.name}</span><span class="dim">{s.host}</span></div>}
            </For>
          </Widget>
        </Show>

        <Show when={show("docker")}>
          <Widget title="Docker" icon="🐳" onOpen={() => openTool("docker")}>
            <Show when={docker()} fallback={<div class="dim small">Проверяю…</div>}>
              {(d) => (
                <Show when={d().state === "ok"} fallback={<div class="dim small">{d().state === "missing" ? "Docker не установлен" : "Docker не запущен"}</div>}>
                  <div class="cc-big"><span classList={{ ok: d().running > 0 }}>▶ {d().running}</span><span class="dim">из {d().total}</span></div>
                  <div class="dim small">контейнеров работает</div>
                </Show>
              )}
            </Show>
          </Widget>
        </Show>

        <Show when={show("services")}>
          <Widget title="Службы магазина" icon="🗄" onOpen={() => openTool("store")}>
            <For each={runningServices()} fallback={<div class="dim small">Ничего не запущено. PostgreSQL, Redis и другие — в магазине.</div>}>
              {(id) => <div class="cc-row"><span class="store-live">●</span><span data-no-translate>{id}</span></div>}
            </For>
          </Widget>
        </Show>

        <Show when={show("vms")}>
          <Widget title="Виртуальные машины" icon="🖥" onOpen={() => openTool("vm")}>
            <div class="cc-big"><span classList={{ ok: vmRun() > 0 }}>▶ {vmRun()}</span></div>
            <div class="dim small">машин работает</div>
          </Widget>
        </Show>
      </div>
    </div>
  );
}
