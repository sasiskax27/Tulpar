// 🖥 Панель «Серверы».
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { core } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { ask } from "../i18n/dialog";
import { runInTerminal } from "../terminal/sessions";
import {
  exec, keySetupCommand, listDir, openRemoteFile, saveServers, serviceAction, serviceLogs, servers, services, sshArgs, sshCommandLine, stats,
  type RemoteEntry, type Server, type Service, type Stats,
} from "./servers";

const EMPTY: Server = { id: "", name: "", host: "", user: "root", port: 22, excludes: "node_modules, .git, target, dist, .venv, __pycache__, .env" };

function size(n: number) {
  return n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;
}

function ServerForm(props: { value: Server; onSave: (s: Server) => void; onCancel: () => void }) {
  const [s, setS] = createSignal<Server>({ ...props.value });
  const field = (key: keyof Server, label: string, placeholder = "", type = "text") => (
    <label class="srv-field">
      <span>{label}</span>
      <input
        type={type}
        value={String(s()[key] ?? "")}
        placeholder={placeholder}
        onInput={(e) => setS({ ...s(), [key]: type === "number" ? Number(e.currentTarget.value) : e.currentTarget.value })}
        data-no-translate
      />
    </label>
  );
  return (
    <div class="srv-form">
      <div class="srv-grid">
        {field("name", "Название", "Мой VPS")}
        {field("host", "Адрес", "203.0.113.10 или example.com")}
        {field("user", "Пользователь", "root")}
        {field("port", "Порт", "22", "number")}
        {field("key", "Ключ (необязательно)", "C:\\Users\\…\\.ssh\\id_ed25519")}
        {field("home", "Стартовая папка", "/var/www")}
      </div>
      <div class="tool-sub">Деплой</div>
      <div class="srv-grid">
        {field("deployDir", "Папка на сервере", "/var/www/my-site")}
        {field("afterDeploy", "Команда после заливки", "npm ci && pm2 restart app")}
        {field("excludes", "Не заливать", "node_modules, .git, .env")}
      </div>
      <div class="tool-row">
        <button class="primary" disabled={!s().host.trim() || !s().user.trim()} onClick={() => props.onSave({ ...s(), id: s().id || crypto.randomUUID(), name: s().name.trim() || s().host.trim() })}>Сохранить</button>
        <button onClick={props.onCancel}>Отмена</button>
      </div>
    </div>
  );
}

export default function ServersView() {
  const [editing, setEditing] = createSignal<Server | null>(null);
  const [current, setCurrent] = createSignal<Server | null>(servers()[0] ?? null);
  const [tab, setTab] = createSignal<"overview" | "files" | "services" | "deploy">("overview");
  const [st, setSt] = createSignal<Stats | null>(null);
  const [err, setErr] = createSignal("");
  const [cwd, setCwd] = createSignal("");
  const [entries, setEntries] = createSignal<RemoteEntry[]>([]);
  const [svc, setSvc] = createSignal<Service[]>([]);
  const [svcFilter, setSvcFilter] = createSignal("");
  const [log, setLog] = createSignal<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = createSignal("");
  const [cmd, setCmd] = createSignal("");

  const save = (s: Server) => {
    const list = servers().some((x) => x.id === s.id) ? servers().map((x) => (x.id === s.id ? s : x)) : [...servers(), s];
    saveServers(list);
    setEditing(null);
    setCurrent(s);
  };

  const remove = async (s: Server) => {
    if (!(await ask(`Убрать сервер «${s.name}» из списка? На самом сервере ничего не изменится.`, { kind: "warning" }))) return;
    saveServers(servers().filter((x) => x.id !== s.id));
    setCurrent(servers()[0] ?? null);
  };

  const refreshStats = async () => {
    const s = current();
    if (!s || tab() !== "overview") return;
    try {
      setSt(await stats(s));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  createEffect(on([current, tab], () => {
    setSt(null);
    setErr("");
    setLog(null);
    if (tab() === "overview") void refreshStats();
    if (tab() === "files") void openDir(current()?.home || "~");
    if (tab() === "services") void loadServices();
  }));
  const timer = setInterval(() => void refreshStats(), 5000);
  onCleanup(() => clearInterval(timer));

  const openDir = async (path: string) => {
    const s = current();
    if (!s) return;
    setBusy("files");
    try {
      const r = await listDir(s, path === "~" ? "." : path);
      setCwd(r.path);
      setEntries(r.entries);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const up = () => openDir(cwd().replace(/\/[^/]+\/?$/, "") || "/");
  const join = (name: string) => (cwd().endsWith("/") ? cwd() + name : `${cwd()}/${name}`);

  const loadServices = async () => {
    const s = current();
    if (!s) return;
    setBusy("services");
    try {
      setSvc(await services(s));
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const svcAct = async (name: string, verb: "start" | "stop" | "restart") => {
    const s = current();
    if (!s) return;
    try {
      await serviceAction(s, name, verb);
      notify(`${name}: ${verb} — готово`);
      void loadServices();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  const testConn = async () => {
    const s = current();
    if (!s) return;
    setBusy("test");
    try {
      const r = await exec(s, "echo ok && uname -a", undefined, 15);
      notify(r.code === 0 ? `✓ Связь есть: ${r.stdout.split("\n")[1] ?? ""}` : r.stderr, r.code === 0 ? undefined : "error");
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const runCmd = async () => {
    const s = current();
    if (!s || !cmd().trim()) return;
    setBusy("cmd");
    try {
      const r = await exec(s, cmd(), undefined, 120);
      setLog({ title: `$ ${cmd()}`, text: (r.stdout + r.stderr) || "(пусто)" });
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  const deploy = async () => {
    const s = current();
    const r = root();
    if (!s || !r) {
      notify("Откройте папку проекта, который заливать");
      return;
    }
    if (!s.deployDir?.trim()) {
      notify("Укажите в настройках сервера «Папку на сервере» для деплоя");
      setEditing(s);
      return;
    }
    if (!(await ask(`Залить проект в ${s.name}:${s.deployDir}${s.afterDeploy ? ` и выполнить «${s.afterDeploy}»` : ""}? Файлы с такими же именами на сервере будут заменены.`, { kind: "warning" }))) return;
    setBusy("deploy");
    try {
      const excludes = (s.excludes ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const res = await core.sshDeploy(sshArgs(s), r, s.deployDir.trim(), excludes, s.afterDeploy ?? "");
      setLog({ title: `🚀 Деплой: ${res.files} файлов, ${size(res.bytes)}`, text: res.output || (res.code === 0 ? "Готово ✓" : "") });
      notify(res.code === 0 ? `🚀 Залито на ${s.name}` : "Деплой завершился с ошибкой — смотрите вывод", res.code === 0 ? undefined : "error");
      void import("../flight/flight").then((f) => f.log("run", `Деплой на ${s.name}: ${res.files} файлов`, res.code === 0));
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy("");
    }
  };

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div class="tool servers">
      <Show when={editing()}>
        {(e) => <ServerForm value={e()} onSave={save} onCancel={() => setEditing(null)} />}
      </Show>
      <Show when={!editing()}>
        <div class="tool-row">
          <div class="srv-tabs">
            <For each={servers()}>
              {(s) => (
                <button classList={{ on: current()?.id === s.id }} onClick={() => setCurrent(s)} data-no-translate>
                  🖥 {s.name}
                </button>
              )}
            </For>
            <button onClick={() => setEditing({ ...EMPTY })}>+ Сервер</button>
          </div>
        </div>
        <Show
          when={current()}
          fallback={
            <div class="tool-empty">
              Добавьте сервер (VPS, Raspberry Pi, домашний Linux) — и управляйте им отсюда: терминал, файлы, сервисы, нагрузка и деплой в один клик.
              <br />
              <button class="primary" onClick={() => setEditing({ ...EMPTY })}>+ Добавить сервер</button>
            </div>
          }
        >
          {(s) => (
            <>
              <div class="tool-row">
                <b data-no-translate>{s().user}@{s().host}:{s().port}</b>
                <span class="grow" />
                <button onClick={() => void runInTerminal(sshCommandLine(s()), s().name)}>⌨ Терминал</button>
                <button title="Создать ключ на этом компьютере и добавить на сервер — один раз ввести пароль" onClick={() => void runInTerminal(keySetupCommand(s()), `Ключ для ${s().name}`)}>🔑 Подключить ключ</button>
                <button disabled={busy() === "test"} onClick={() => void testConn()}>Проверить</button>
                <button onClick={() => setEditing(s())}>✎</button>
                <button onClick={() => void remove(s())}>🗑</button>
              </div>
              <div class="tool-tabs">
                <button classList={{ on: tab() === "overview" }} onClick={() => setTab("overview")}>📊 Обзор</button>
                <button classList={{ on: tab() === "files" }} onClick={() => setTab("files")}>📁 Файлы</button>
                <button classList={{ on: tab() === "services" }} onClick={() => setTab("services")}>⚙ Сервисы</button>
                <button classList={{ on: tab() === "deploy" }} onClick={() => setTab("deploy")}>🚀 Деплой</button>
              </div>
              <Show when={err()}>
                <div class="tool-error">
                  {err()}
                  <Show when={/ключ/.test(err())}>
                    {" "}
                    <button onClick={() => void runInTerminal(keySetupCommand(s()), `Ключ для ${s().name}`)}>🔑 Подключить ключ</button>
                  </Show>
                </div>
              </Show>

              <Show when={tab() === "overview" && st()}>
                {(x) => (
                  <>
                    <div class="dim small" data-no-translate>{x().hostname} · {x().os} · работает {x().uptime}</div>
                    <div class="stats-cards">
                      <div class="stats-card"><b>{x().load.split(" ")[0] || "—"}</b><span>нагрузка ({x().cpus} ядер)</span></div>
                      <div class="stats-card"><b>{pct(x().memUsed, x().memTotal)}%</b><span>память: {x().memUsed} из {x().memTotal} МБ</span></div>
                      <div class="stats-card"><b>{x().diskPct}%</b><span>диск: {x().diskUsed} из {x().diskTotal}</span></div>
                    </div>
                    <div class="tool-sub">Самые занятые процессы</div>
                    <table class="tool-table" data-no-translate>
                      <For each={x().procs}>{(p) => <tr><td>{p.pid}</td><td>CPU {p.cpu}%</td><td>RAM {p.mem}%</td><td>{p.cmd}</td></tr>}</For>
                    </table>
                  </>
                )}
              </Show>
              <Show when={tab() === "overview" && !st() && !err()}><div class="tool-empty">Подключаюсь…</div></Show>
              <Show when={tab() === "overview"}>
                <div class="tool-row">
                  <input class="tool-input grow mono" placeholder="Команда на сервере, например: docker ps" value={cmd()} onInput={(e) => setCmd(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void runCmd()} data-no-translate />
                  <button disabled={busy() === "cmd"} onClick={() => void runCmd()}>Выполнить</button>
                </div>
              </Show>

              <Show when={tab() === "files"}>
                <div class="tool-row">
                  <button onClick={() => void up()} title="Наверх">⬆</button>
                  <code class="grow" data-no-translate>{cwd()}</code>
                  <button onClick={() => void openDir(cwd())}>↻</button>
                </div>
                <div class="srv-files">
                  <For each={entries()}>
                    {(e) => (
                      <button class="srv-file" onClick={() => (e.dir ? void openDir(join(e.name)) : void openRemoteFile(s(), join(e.name)).catch((x) => notify(String(x), "error")))}>
                        <span>{e.dir ? "📁" : "📄"}</span>
                        <span class="grow" data-no-translate>{e.name}</span>
                        <span class="dim small">{e.dir ? "" : size(e.size)}</span>
                      </button>
                    )}
                  </For>
                </div>
                <div class="dim small">Файл откроется в редакторе. Ctrl+S — сохранит прямо на сервер.</div>
              </Show>

              <Show when={tab() === "services"}>
                <div class="tool-row">
                  <input class="tool-input grow" placeholder="Фильтр: nginx, docker, postgres…" value={svcFilter()} onInput={(e) => setSvcFilter(e.currentTarget.value)} />
                  <button disabled={busy() === "services"} onClick={() => void loadServices()}>↻</button>
                </div>
                <div class="docker-list">
                  <For each={svc().filter((x) => !svcFilter() || x.name.includes(svcFilter().toLowerCase()) || x.description.toLowerCase().includes(svcFilter().toLowerCase())).slice(0, 120)}>
                    {(x) => (
                      <div class="docker-item">
                        <span class={"docker-dot " + (x.sub === "running" ? "on" : "off")} />
                        <div class="docker-main">
                          <b data-no-translate>{x.name}</b>
                          <span class="dim small" data-no-translate>{x.sub} · {x.description}</span>
                        </div>
                        <div class="docker-actions">
                          <Show when={x.sub === "running"} fallback={<button title="Запустить" onClick={() => void svcAct(x.name, "start")}>▶</button>}>
                            <button title="Перезапустить" onClick={() => void svcAct(x.name, "restart")}>↻</button>
                            <button title="Остановить" onClick={() => void svcAct(x.name, "stop")}>■</button>
                          </Show>
                          <button title="Логи" onClick={() => void serviceLogs(s(), x.name).then((t) => setLog({ title: `📜 ${x.name}`, text: t }))}>📜</button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={tab() === "deploy"}>
                <div class="srv-deploy">
                  <div>Откуда: <code data-no-translate>{root() ?? "— откройте папку проекта"}</code></div>
                  <div>Куда: <code data-no-translate>{s().deployDir || "— не указано"}</code></div>
                  <div>После: <code data-no-translate>{s().afterDeploy || "—"}</code></div>
                  <div class="dim small" data-no-translate>Не заливается: {s().excludes || "—"}</div>
                  <div class="tool-row">
                    <button class="primary" disabled={busy() === "deploy"} onClick={() => void deploy()}>{busy() === "deploy" ? "Заливаю…" : "🚀 Залить на сервер"}</button>
                    <button onClick={() => setEditing(s())}>Настроить</button>
                  </div>
                </div>
              </Show>

              <Show when={log()}>
                {(l) => (
                  <div class="docker-log">
                    <div class="tool-row">
                      <b data-no-translate>{l().title}</b>
                      <span class="grow" />
                      <button onClick={() => setLog(null)}>✕</button>
                    </div>
                    <pre class="tool-out mono" data-no-translate>{l().text}</pre>
                  </div>
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
