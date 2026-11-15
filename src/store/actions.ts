// Установка и запуск пунктов магазина.
import { createSignal } from "solid-js";
import { core } from "../ipc";
import { notify } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";
import { installRuntime } from "../runtimes/runtimes";
import { OS, systemInstall } from "./platform";
import type { StoreItem } from "./catalog";

const [installed, setInstalled] = createSignal<Record<string, string>>({});
const [systemHas, setSystemHas] = createSignal<Record<string, boolean>>({});
const [running, setRunning] = createSignal<Record<string, boolean>>({});
const [busy, setBusy] = createSignal<Record<string, string>>({});
export { installed, systemHas, running, busy };

const mark = (id: string, what: string | null) => setBusy((b) => {
  const n = { ...b };
  if (what) n[id] = what;
  else delete n[id];
  return n;
});

export async function refreshInstalled(items: StoreItem[]) {
  const list = await core.runtimesList().catch(() => []);
  setInstalled(Object.fromEntries(list.map((x) => [x.kind, x.version || "есть"])));
  const sys: Record<string, boolean> = {};
  await Promise.all(items.filter((i) => i.check && !installed()[i.id]).map(async (i) => {
    const r = await core.agentRun(i.check!, 15).catch(() => null);
    sys[i.id] = !!r && r.code === 0;
  }));
  setSystemHas(sys);
}

export async function refreshRunning() {
  const st = await core.serviceStatus().catch(() => []);
  setRunning(Object.fromEntries(st.map((s) => [s.id, s.running])));
}

export async function install(item: StoreItem): Promise<boolean> {
  if (item.runtime) {
    mark(item.id, "install");
    const ok = await installRuntime(item.runtime);
    mark(item.id, null);
    return ok;
  }
  if (OS === "windows" && item.windows) {
    mark(item.id, "install");
    try {
      const { url, version } = await item.windows.resolve();
      notify(`⚡ Скачиваю ${item.title} ${version}…`);
      await core.runtimeInstall(item.id, url, item.windows.bins, version);
      notify(`✓ ${item.title} ${version} установлен`);
      void import("../flight/flight").then((f) => f.log("run", `Магазин: установлен ${item.title} ${version}`, true));
      return true;
    } catch (e) {
      notify(`Не удалось поставить ${item.title}: ${e}`, "error");
      return false;
    } finally {
      mark(item.id, null);
    }
  }
  const cmd = item.pkgs ? await systemInstall(item.pkgs) : null;
  if (!cmd) {
    notify(`Для этой системы ${item.title} пока не ставится автоматически`, "error");
    return false;
  }
  await runInTerminal(cmd, `Установка ${item.title}`);
  notify(`Установка ${item.title} идёт в терминале. Когда закончится — нажмите «Обновить».`);
  return false;
}

export async function uninstall(item: StoreItem) {
  if (running()[item.id]) await stop(item);
  await core.runtimeRemove(item.id);
  notify(`${item.title} удалён из Tulpar`);
}

export async function start(item: StoreItem) {
  const svc = item.service;
  if (!svc) return;
  if (OS !== "windows" || !installed()[item.id]) {
    // Системная установка: brew services / systemctl
    const cmd = OS === "mac" ? `brew services start ${svc.unixService}` : `sudo systemctl start ${svc.unixService}`;
    await runInTerminal(cmd, item.title);
    return;
  }
  mark(item.id, "start");
  try {
    await svc.setup?.();
    await core.serviceStart(item.id, item.id, svc.exe, svc.args());
    await new Promise((r) => setTimeout(r, 900));
    await refreshRunning();
    if (!running()[item.id]) {
      const log = await core.serviceLogs(item.id);
      throw new Error(log.split("\n").filter(Boolean).slice(-3).join(" ") || "сервер сразу остановился");
    }
    notify(`▶ ${item.title} работает на порту ${svc.port}`);
    void import("../flight/flight").then((f) => f.log("run", `Запущен ${item.title} :${svc.port}`, true));
  } catch (e) {
    notify(`${item.title}: ${e instanceof Error ? e.message : e}`, "error");
  } finally {
    mark(item.id, null);
  }
}

export async function stop(item: StoreItem) {
  const svc = item.service;
  if (!svc) return;
  if (OS !== "windows" || !installed()[item.id]) {
    const cmd = OS === "mac" ? `brew services stop ${svc.unixService}` : `sudo systemctl stop ${svc.unixService}`;
    await runInTerminal(cmd, item.title);
    return;
  }
  mark(item.id, "stop");
  await svc.stop?.();
  await core.serviceStop(item.id);
  await refreshRunning();
  mark(item.id, null);
}
