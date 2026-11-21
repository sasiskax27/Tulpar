// История буфера обмена: запоминаем скопированные куски (до 50) и даём вставить
// любой из них через палитру. Хранится в localStorage — переживает перезапуск.
import { pick } from "./QuickPick";
import { notify } from "./notify";

const KEY = "tulpar.clipboardHistory";
const MAX = 50;

export function clipboardEntries(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persist(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Запомнить скопированный текст (без дублей подряд и слишком длинных кусков). */
export function pushClipboard(text: string | null | undefined) {
  if (!text) return;
  const t = text.length > 20000 ? text.slice(0, 20000) : text;
  const list = clipboardEntries();
  if (!t.trim()) return;
  if (list[0] === t) return;
  const next = [t, ...list.filter((x) => x !== t)].slice(0, MAX);
  persist(next);
}

/** Подслушать копирование: обычный Ctrl+C в редакторе, терминале и где угодно ещё. */
export function initClipboardHistory() {
  document.addEventListener("copy", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text) pushClipboard(text);
  });
  document.addEventListener("cut", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text) pushClipboard(text);
  });
}

function label(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 90 ? one.slice(0, 90) + "…" : one || "(пусто)";
}

function insert(text: string) {
  const el = document.activeElement as HTMLElement | null;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // Вставка в поле (чат, поиск, терминал-инпут)
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  void navigator.clipboard.writeText(text).then(
    () => notify("Скопировано — вставьте Ctrl+V"),
    () => notify("Не удалось поместить в буфер обмена"),
  );
}

/** Выбрать кусок из истории и вставить/скопировать. */
export async function showClipboardHistory(): Promise<void> {
  const list = clipboardEntries();
  if (!list.length) {
    notify("История пуста — скопируйте что-нибудь (Ctrl+C)");
    return;
  }
  const chosen = await pick(
    list.map((t, i) => ({
      label: label(t),
      detail: i === 0 ? "последний" : `${t.split("\n").length} стр.`,
      value: t,
    })),
    "История буфера обмена — что сделать?",
  );
  if (chosen === null) return;
  insert(chosen);
}

/** Очистить историю. */
export function clearClipboardHistory() {
  persist([]);
}
