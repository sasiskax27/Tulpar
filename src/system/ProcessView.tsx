// ⚙ Процессы и порты: что запущено, сколько ест и кто занял порт.
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { core } from "../ipc";
import { ask } from "../i18n/dialog";
import { notify, notifyError } from "../app/notify";
import { parsePorts, parseProcesses, type Port, type Proc } from "./parse";

type Sort = "mem" | "cpu" | "name";

export default function ProcessView() {
  const [tab, setTab] = createSignal<"proc" | "ports">("ports");
  const [procs, setProcs] = createSignal<Proc[]>([]);
  const [ports, setPorts] = createSignal<Port[]>([]);
  const [q, setQ] = createSignal("");
  const [sort, setSort] = createSignal<Sort>("mem");
  const [error, setError] = createSignal("");
  const [auto, setAuto] = createSignal(true);

  const load = async () => {
    try {
      const p = parseProcesses(await core.sysQuery("processes"));
      setProcs(p);
      setPorts(parsePorts(await core.sysQuery("ports"), p));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  onMount(() => void load());
  const timer = setInterval(() => auto() && void load(), 4000);
  onCleanup(() => clearInterval(timer));

  const kill = async (pid: number | null, name: string) => {
    if (pid == null) return;
    if (!(await ask(`Завершить «${name}» (PID ${pid})? Несохранённые данные в этой программе пропадут.`, { title: "Завершить процесс", kind: "warning" }))) return;
    try {
      await core.sysKill(pid);
      notify(`Процесс ${name} завершён`);
      void load();
    } catch (e) {
      notifyError("Не удалось завершить", e);
    }
  };

  const shownProcs = createMemo(() => {
    const needle = q().toLowerCase();
    const list = procs().filter((p) => !needle || p.name.toLowerCase().includes(needle) || String(p.pid) === needle);
    const s = sort();
    return [...list].sort((a, b) => (s === "name" ? a.name.localeCompare(b.name) : s === "cpu" ? b.cpu - a.cpu : b.memMb - a.memMb)).slice(0, 300);
  });
  const shownPorts = createMemo(() => {
    const needle = q().toLowerCase();
    return ports().filter((p) => !needle || String(p.port).includes(needle) || p.process.toLowerCase().includes(needle));
  });
  const totalMem = () => procs().reduce((a, p) => a + p.memMb, 0);

  return (
    <div class="tool">
      <div class="tool-row">
        <div class="tool-tabs">
          <button classList={{ on: tab() === "ports" }} onClick={() => setTab("ports")}>🔌 Порты ({ports().length})</button>
          <button classList={{ on: tab() === "proc" }} onClick={() => setTab("proc")}>⚙ Процессы ({procs().length})</button>
        </div>
        <span class="grow" />
        <input class="tool-input" placeholder={tab() === "ports" ? "Порт или программа" : "Имя или PID"} value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        <label class="small"><input type="checkbox" checked={auto()} onChange={(e) => setAuto(e.currentTarget.checked)} /> обновлять</label>
        <button onClick={() => void load()}>⟳</button>
      </div>
      <Show when={error()}><div class="tool-error">{error()}</div></Show>

      <Show when={tab() === "ports"}>
        <div class="dim small">Кто слушает порты на этом компьютере. «Порт занят» при запуске сервера — найдите его здесь и завершите.</div>
        <table class="tool-table sys-table">
          <thead><tr><th>Порт</th><th>Адрес</th><th>Программа</th><th>PID</th><th /></tr></thead>
          <tbody>
            <For each={shownPorts()}>
              {(p) => (
                <tr>
                  <td><b>{p.port}</b></td>
                  <td class="dim">{p.address}</td>
                  <td data-no-translate>{p.process || "—"}</td>
                  <td class="dim">{p.pid ?? "—"}</td>
                  <td class="sys-actions">
                    <Show when={/^(0\.0\.0\.0|127\.0\.0\.1|::|\[::\]|\*|::1|\[::1\])$/.test(p.address) || p.address === ""}>
                      <button class="link small" onClick={() => void core.openUrl(`http://localhost:${p.port}`)}>Открыть</button>
                    </Show>
                    <Show when={p.pid}><button class="link small danger" onClick={() => void kill(p.pid, p.process || String(p.pid))}>Завершить</button></Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <Show when={tab() === "proc"}>
        <div class="dim small">Всего памяти у процессов: {(totalMem() / 1024).toFixed(1)} ГБ. Нажмите на заголовок, чтобы отсортировать.</div>
        <table class="tool-table sys-table">
          <thead>
            <tr>
              <th class="sortable" onClick={() => setSort("name")}>Программа {sort() === "name" ? "↓" : ""}</th>
              <th>PID</th>
              <th class="sortable" onClick={() => setSort("cpu")}>CPU {sort() === "cpu" ? "↓" : ""}</th>
              <th class="sortable" onClick={() => setSort("mem")}>Память {sort() === "mem" ? "↓" : ""}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={shownProcs()}>
              {(p) => (
                <tr>
                  <td data-no-translate>{p.name}</td>
                  <td class="dim">{p.pid}</td>
                  <td>{p.cpu}</td>
                  <td>
                    <div class="sys-bar"><div style={{ width: `${Math.min(100, (p.memMb / Math.max(1, shownProcs()[0]?.memMb ?? 1)) * 100)}%` }} /></div>
                    {p.memMb} МБ
                  </td>
                  <td class="sys-actions"><button class="link small danger" onClick={() => void kill(p.pid, p.name)}>Завершить</button></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
