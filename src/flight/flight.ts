// 🎞 Flight Recorder: лента важных событий проекта — сохранения, коммиты,
// тесты, ошибки, работа ИИ. Хранится только локально, по проектам.
import { createSignal } from "solid-js";
import { root } from "../app/workspace";

export type FlightKind = "save" | "commit" | "test" | "ai" | "agent" | "errors" | "doctor" | "security" | "collab" | "run" | "note";

export interface FlightEvent {
  t: number;
  kind: FlightKind;
  text: string;
  ok?: boolean;
}

const MAX = 3000;
const key = () => `tulpar.flight:${root() ?? "-"}`;
const [version, setVersion] = createSignal(0);
export { version as flightVersion };

export function events(): FlightEvent[] {
  version();
  try {
    return JSON.parse(localStorage.getItem(key()) ?? "[]") as FlightEvent[];
  } catch {
    return [];
  }
}

export function log(kind: FlightKind, text: string, ok?: boolean) {
  if (!root()) return;
  const list = events();
  const last = list[list.length - 1];
  // Подряд одинаковые события за минуту — склеиваем
  if (last && last.kind === kind && last.text === text && Date.now() - last.t < 60_000) {
    last.t = Date.now();
  } else list.push({ t: Date.now(), kind, text, ok });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  try {
    localStorage.setItem(key(), JSON.stringify(list));
  } catch {
    list.splice(0, Math.floor(list.length / 2));
    try {
      localStorage.setItem(key(), JSON.stringify(list));
    } catch {
      /* ничего */
    }
  }
  setVersion((v) => v + 1);
}

export function clearFlight() {
  localStorage.removeItem(key());
  setVersion((v) => v + 1);
}

export const ICONS: Record<FlightKind, string> = {
  save: "💾", commit: "🌱", test: "🧪", ai: "✦", agent: "🤖", errors: "🐞", doctor: "🩺", security: "🛡", collab: "👥", run: "▶", note: "📝",
};
