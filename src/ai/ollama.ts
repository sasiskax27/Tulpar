// Состояние локального ИИ: запущена ли Ollama, что установлено, что скачивается.
import { createSignal } from "solid-js";
import { core, events } from "../ipc";
import { settings, updateSetting } from "../config/store";
import { notify, notifyError } from "../app/notify";
import { providers } from "./ai";
import { switchService } from "./services";
import type { CatalogModel } from "./models";

export interface Progress {
  status: string;
  /** 0..1 или null, пока размер неизвестен */
  fraction: number | null;
}

const [running, setRunning] = createSignal<boolean | null>(null);
const [installed, setInstalled] = createSignal<{ name: string; size: number }[]>([]);
const [memory, setMemory] = createSignal<{ ramGb: number | null; vramGb: number | null }>({ ramGb: null, vramGb: null });
const [progress, setProgress] = createSignal<Record<string, Progress>>({});
export { running, installed, memory, progress };

/** Адрес самой Ollama: тот же, что в настройках ИИ, но без «/v1». */
export function ollamaHost(): string {
  const s = settings();
  const custom = s["tulpar.ai.provider"] === "ollama" ? s["tulpar.ai.baseUrl"].trim() : "";
  return (custom || providers.ollama.baseUrl).replace(/\/v1\/?$/, "");
}

/** «qwen3.5» и «qwen3.5:latest» — одна и та же модель. */
export function normalize(tag: string): string {
  return tag.includes(":") ? tag : `${tag}:latest`;
}

export function isInstalled(tag: string): boolean {
  return installed().some((m) => normalize(m.name) === normalize(tag));
}

export function isCurrent(tag: string): boolean {
  const s = settings();
  return s["tulpar.ai.provider"] === "ollama" && normalize(s["tulpar.ai.model"].trim() || "-") === normalize(tag);
}

export async function refresh() {
  try {
    const status = await core.ollamaStatus(ollamaHost());
    setRunning(status.running);
    setInstalled(status.models);
  } catch {
    setRunning(false);
  }
}

let listening = false;

export async function initLocalAi() {
  if (!listening) {
    listening = true;
    await events.onOllamaProgress((p) => {
      setProgress((all) => ({
        ...all,
        [p.model]: { status: p.status, fraction: p.total > 0 ? p.completed / p.total : null },
      }));
    });
    core.systemMemory().then(setMemory).catch(() => undefined);
  }
  await refresh();
}

export function useModel(tag: string) {
  switchService("ollama");
  updateSetting("tulpar.ai.model", tag);
  notify(`ИИ: выбрана модель ${tag}`);
}

export async function install(tag: string) {
  if (progress()[tag]) return;
  setProgress((all) => ({ ...all, [tag]: { status: "подключение", fraction: null } }));
  try {
    await core.ollamaPull(ollamaHost(), tag);
    await refresh();
    // Первая установленная модель сразу становится рабочей
    if (settings()["tulpar.ai.provider"] !== "ollama" || !settings()["tulpar.ai.model"].trim()) useModel(tag);
    else notify(`Модель ${tag} установлена`);
  } catch (e) {
    notifyError(`Не удалось установить ${tag}`, e);
  } finally {
    setProgress((all) => {
      const rest = { ...all };
      delete rest[tag];
      return rest;
    });
  }
}

export async function remove(tag: string) {
  try {
    await core.ollamaDelete(ollamaHost(), tag);
    if (isCurrent(tag)) updateSetting("tulpar.ai.model", "");
    await refresh();
  } catch (e) {
    notifyError(`Не удалось удалить ${tag}`, e);
  }
}

export type Fit = "fast" | "slow" | "no" | "unknown";

/** Запустится ли модель на этом компьютере. Модели нужно примерно на 15% больше
 *  её размера плюс гигабайт на контекст. */
export function fitOf(model: CatalogModel): Fit {
  const { ramGb, vramGb } = memory();
  if (ramGb === null) return "unknown";
  const need = model.sizeGb * 1.15 + 1;
  if (vramGb !== null && need <= vramGb) return "fast";
  return need <= ramGb * 0.75 ? "slow" : "no";
}

let warmed = "";
/** Заранее загрузить выбранную модель в память, пока человек пишет вопрос:
 *  первый ответ тогда приходит сразу, а не через полминуты. */
export function warmUp() {
  const s = settings();
  const model = s["tulpar.ai.model"].trim();
  if (s["tulpar.ai.provider"] !== "ollama" || !model || model.includes("cloud") || warmed === model) return;
  warmed = model;
  void core
    .httpRequest({ method: "POST", url: `${ollamaHost()}/api/generate`, headers: [["Content-Type", "application/json"]], body: JSON.stringify({ model, keep_alive: "30m" }), timeoutSecs: 120 })
    .catch(() => (warmed = ""));
}
