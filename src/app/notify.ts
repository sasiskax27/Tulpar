// Простые всплывающие уведомления. Позже их заменит полноценный центр уведомлений.
import { createSignal } from "solid-js";

export interface Notice {
  id: number;
  text: string;
  level: "info" | "error";
}

const [notices, setNotices] = createSignal<Notice[]>([]);
let nextId = 1;

export { notices };

export function notify(text: string, level: Notice["level"] = "info") {
  const id = nextId++;
  setNotices((list) => [...list, { id, text, level }]);
  setTimeout(() => setNotices((list) => list.filter((n) => n.id !== id)), level === "error" ? 8000 : 4000);
}

export function notifyError(prefix: string, err: unknown) {
  notify(`${prefix}: ${err instanceof Error ? err.message : String(err)}`, "error");
}
