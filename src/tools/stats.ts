// 📊 Своя статистика: сколько минут вы реально пишете код, на каких языках,
// серия дней подряд. Хранится только у вас (localStorage), никуда не уходит.
import { createSignal } from "solid-js";
import { settings } from "../config/store";

const KEY = "tulpar.stats";

export interface DayStats {
  /** минуты по языкам */
  langs: Record<string, number>;
  /** правок за день */
  edits: number;
  /** по часам суток: минуты */
  hours?: number[];
}

type Stats = Record<string, DayStats>; // ключ — YYYY-MM-DD

function load(): Stats {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Stats;
  } catch {
    return {};
  }
}

const [stats, setStats] = createSignal<Stats>(load());
export { stats };

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let lastMinute = "";
let pendingEdits = 0;
let saveTimer = 0;

/** Вызывается на каждую правку. Минута засчитывается один раз. */
export function recordEdit(language: string) {
  if (settings()["tulpar.stats.enabled"] === false) return;
  pendingEdits++;
  const now = new Date();
  const minute = `${dayKey(now)} ${now.getHours()}:${now.getMinutes()} ${language}`;
  const next = { ...stats() };
  const day = (next[dayKey(now)] ??= { langs: {}, edits: 0, hours: Array(24).fill(0) });
  day.hours ??= Array(24).fill(0);
  if (minute !== lastMinute) {
    lastMinute = minute;
    day.langs[language] = (day.langs[language] ?? 0) + 1;
    day.hours[now.getHours()]++;
  }
  day.edits += pendingEdits;
  pendingEdits = 0;
  setStats(next);
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(stats()));
    } catch {
      /* переполнено */
    }
  }, 3000);
}

export const minutesOf = (d?: DayStats) => (d ? Object.values(d.langs).reduce((a, b) => a + b, 0) : 0);

/** Серия: сколько дней подряд (до сегодня или вчера) писали код хотя бы 5 минут. */
export function streak(s: Stats): number {
  let n = 0;
  const d = new Date();
  if (minutesOf(s[dayKey(d)]) < 5) d.setDate(d.getDate() - 1);
  while (minutesOf(s[dayKey(d)]) >= 5) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function lastDays(s: Stats, n: number): { key: string; label: string; minutes: number }[] {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    const key = dayKey(d);
    out.push({ key, label: `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`, minutes: minutesOf(s[key]) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function languageTotals(s: Stats, days: string[]): [string, number][] {
  const total: Record<string, number> = {};
  for (const k of days) for (const [l, m] of Object.entries(s[k]?.langs ?? {})) total[l] = (total[l] ?? 0) + m;
  return Object.entries(total).sort((a, b) => b[1] - a[1]);
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

export function resetStats() {
  setStats({});
  localStorage.removeItem(KEY);
}

// ---- Фокус-таймер (помидор) ----
const [focusEnd, setFocusEnd] = createSignal<number | null>(null);
export { focusEnd };
let focusTimer = 0;

export function startFocus(minutes: number, onDone: () => void) {
  clearTimeout(focusTimer);
  setFocusEnd(Date.now() + minutes * 60_000);
  focusTimer = window.setTimeout(() => {
    setFocusEnd(null);
    void import("../hype/achievements").then((a) => a.unlock("focus-done"));
    onDone();
  }, minutes * 60_000);
}

export function stopFocus() {
  clearTimeout(focusTimer);
  setFocusEnd(null);
}
