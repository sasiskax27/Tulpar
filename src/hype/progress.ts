// Проверки ачивок, которые зависят от времени и статистики.
import { count, unlock } from "./achievements";
import { dayKey, minutesOf, stats, streak, type DayStats } from "../tools/stats";

let lastCheck = 0;

export function addLines(n: number) {
  count("lines", n, { 1000: "lines-1000" });
  count(`lines:${dayKey()}`, n, { 100: "lines-100" });
  const now = Date.now();
  if (now - lastCheck < 30_000) return;
  lastCheck = now;
  const h = new Date().getHours();
  if (h >= 2 && h < 5) unlock("night-owl");
  if (h >= 5 && h < 7) unlock("early-bird");
  const s = stats();
  if (minutesOf(s[dayKey()]) >= 60) unlock("minutes-60");
  const st = streak(s);
  if (st >= 3) unlock("streak-3");
  if (st >= 7) unlock("streak-7");
  const langs = new Set(Object.values(s).flatMap((d) => Object.keys((d as DayStats).langs)).filter((l) => !["plaintext", "json", "markdown"].includes(l)));
  if (langs.size >= 5) unlock("polyglot");
}
