// 🐳 Панель Docker.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { core, joinPath } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { ask } from "../i18n/dialog";
import { runInTerminal } from "../terminal/sessions";
import { action, compose, containers, dockerStatus, images, logs, stats, type Container, type Image, type Stat } from "./docker";

export default function DockerView() {
  const [status, setStatus] = createSignal<"loading" | "ok" | "missing" | "stopped">("loading");
  const [list, setList] = createSignal<Container[]>([]);
  const [imgs, setImgs] = createSignal<Image[]>([]);
  const [st, setSt] = createSignal<Stat[]>([]);
  const [tab, setTab] = createSignal<"containers" | "images">("containers");
  const [log, setLog] = createSignal<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [hasCompose, setHasCompose] = createSignal(false);

  const refresh = async () => {
    const s = await dockerStatus();
    setStatus(s);
    if (s !== "ok") return;
    const [c, i] = await Promise.all([containers(), images()]);
    setList(c);
    setImgs(i);
    if (c.some((x) => x.State === "running")) setSt(await stats());
    const r = root();
    if (r) setHasCompose(await Promise.any(["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].map((f) => core.readFile(joinPath(r, f)).then(() => true))).catch(() => false));
  };
  onMount(() => void refresh());
  const timer = setInterval(() => status() === "ok" && void refresh(), 8000);
  onCleanup(() => clearInterval(timer));

  const act = async (verb: "start" | "stop" | "restart" | "rm" | "rmi", id: string, name: string) => {
    if ((verb === "rm" || verb === "rmi") && !(await ask(`Удалить ${verb === "rm" ? "контейнер" : "образ"} «${name}»? Это нельзя отменить.`, { kind: "warning" }))) return;
    setBusy(id + verb);
    const r = await action(verb, id);
    setBusy(null);
    if (!r.ok) notify(r.out.trim().split("\n").pop() ?? "Не получилось", "error");
    void refresh();
  };

  const comp = async (verb: "up -d" | "down" | "restart" | "pull") => {
    setBusy("compose");
    const r = await compose(verb);
    setBusy(null);
    notify(r.ok ? `docker compose ${verb}: готово` : r.out.trim().split("\n").slice(-2).join(" "), r.ok ? undefined : "error");
    void refresh();
  };

  const statOf = (c: Container) => st().find((s) => s.Name === c.Names);

  return (
    <div class="tool docker">
      <Show when={status() === "missing"}>
        <div class="tool-empty">
          Docker не установлен.
          <br />
          <button class="primary" onClick={() => void core.openUrl("https://www.docker.com/products/docker-desktop/")}>Скачать Docker Desktop</button>
        </div>
      </Show>
      <Show when={status() === "stopped"}>
        <div class="tool-empty">
          Docker установлен, но не запущен. Откройте Docker Desktop и подождите, пока он загрузится.
          <br />
          <button onClick={() => void refresh()}>Проверить снова</button>
        </div>
      </Show>
      <Show when={status() === "loading"}><div class="tool-empty">Подключаюсь к Docker…</div></Show>
      <Show when={status() === "ok"}>
        <div class="tool-row">
          <div class="tool-tabs">
            <button classList={{ on: tab() === "containers" }} onClick={() => setTab("containers")}>Контейнеры ({list().length})</button>
            <button classList={{ on: tab() === "images" }} onClick={() => setTab("images")}>Образы ({imgs().length})</button>
          </div>
          <span class="grow" />
          <Show when={hasCompose()}>
            <span class="dim small">compose:</span>
            <button disabled={busy() === "compose"} onClick={() => void comp("up -d")}>▶ up</button>
            <button disabled={busy() === "compose"} onClick={() => void comp("down")}>■ down</button>
            <button disabled={busy() === "compose"} onClick={() => void comp("restart")}>↻</button>
          </Show>
          <button onClick={() => void refresh()}>Обновить</button>
        </div>
        <Show when={tab() === "containers"}>
          <Show when={list().length} fallback={<div class="tool-empty">Контейнеров нет. Запустите <code>docker compose up -d</code> или <code>docker run …</code>.</div>}>
            <div class="docker-list">
              <For each={list()}>
                {(c) => (
                  <div class="docker-item">
                    <span class={"docker-dot " + (c.State === "running" ? "on" : "off")} />
                    <div class="docker-main">
                      <b data-no-translate>{c.Names}</b>
                      <span class="dim small" data-no-translate>{c.Image} · {c.Status}{c.Ports ? ` · ${c.Ports}` : ""}</span>
                      <Show when={statOf(c)}>
                        {(s) => <span class="small" data-no-translate>CPU {s().CPUPerc} · RAM {s().MemUsage}</span>}
                      </Show>
                    </div>
                    <div class="docker-actions">
                      <Show when={c.State === "running"} fallback={<button title="Запустить" onClick={() => void act("start", c.ID, c.Names)}>▶</button>}>
                        <button title="Остановить" onClick={() => void act("stop", c.ID, c.Names)}>■</button>
                        <button title="Перезапустить" onClick={() => void act("restart", c.ID, c.Names)}>↻</button>
                        <button title="Терминал внутри контейнера" onClick={() => void runInTerminal(`docker exec -it ${c.Names} sh`, c.Names)}>⌨</button>
                      </Show>
                      <button title="Логи" onClick={() => void logs(c.ID).then((t) => setLog({ name: c.Names, text: t }))}>📜</button>
                      <button title="Удалить" onClick={() => void act("rm", c.ID, c.Names)}>🗑</button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
        <Show when={tab() === "images"}>
          <div class="docker-list">
            <For each={imgs()}>
              {(i) => (
                <div class="docker-item">
                  <div class="docker-main">
                    <b data-no-translate>{i.Repository}:{i.Tag}</b>
                    <span class="dim small" data-no-translate>{i.Size} · {i.CreatedSince}</span>
                  </div>
                  <div class="docker-actions">
                    <button title="Удалить образ" onClick={() => void act("rmi", i.ID, `${i.Repository}:${i.Tag}`)}>🗑</button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={log()}>
          {(l) => (
            <div class="docker-log">
              <div class="tool-row">
                <b data-no-translate>📜 {l().name}</b>
                <span class="grow" />
                <button onClick={() => setLog(null)}>✕</button>
              </div>
              <pre class="tool-out mono" data-no-translate>{l().text || "(логов нет)"}</pre>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
