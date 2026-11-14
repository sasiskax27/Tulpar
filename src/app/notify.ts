// Всплывающие уведомления. У уведомления могут быть кнопки действий —
// тогда оно висит дольше и закрывается по нажатию.
import { createSignal } from "solid-js";

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  id: number;
  text: string;
  level: "info" | "error";
  actions?: NoticeAction[];
}

const [notices, setNotices] = createSignal<Notice[]>([]);
let nextId = 1;

export { notices };

export function dismiss(id: number) {
  setNotices((list) => list.filter((n) => n.id !== id));
}

export function notify(text: string, level: Notice["level"] = "info", actions?: NoticeAction[]) {
  // Одно и то же сообщение, которое уже на экране, не дублируем
  const same = notices().find((n) => n.text === text);
  if (same) return same.id;
  const id = nextId++;
  setNotices((list) => [...list, { id, text, level, actions }]);
  const ttl = actions?.length ? 20000 : level === "error" ? 8000 : 4000;
  setTimeout(() => dismiss(id), ttl);
  return id;
}

export function notifyError(prefix: string, err: unknown) {
  notify(`${prefix}: ${err instanceof Error ? err.message : String(err)}`, "error");
}
