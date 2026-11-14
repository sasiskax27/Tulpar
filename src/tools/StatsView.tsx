// 📊 Моя статистика и фокус-таймер. Только локально — ни байта наружу.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { notify } from "../app/notify";
import { dayKey, focusEnd, formatMinutes, languageTotals, lastDays, minutesOf, resetStats, startFocus, stats, stopFocus, streak } from "./stats";

export default function StatsView() {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const days = createMemo(() => lastDays(stats(), 14));
  const max = () => Math.max(30, ...days().map((d) => d.minutes));
  const today = () => stats()[dayKey()];
  const week = createMemo(() => days().slice(-7));
  const weekTotal = () => week().reduce((a, d) => a + d.minutes, 0);
  const langs = createMemo(() => languageTotals(stats(), days().map((d) => d.key)));
  const langMax = () => Math.max(1, ...langs().map(([, m]) => m));
  const hours = createMemo(() => {
    const h = Array(24).fill(0);
    for (const d of days()) (stats()[d.key]?.hours ?? []).forEach((m, i) => (h[i] += m));
    return h as number[];
  });
  const bestHour = () => {
    const h = hours();
    const i = h.indexOf(Math.max(...h));
    return h[i] ? `${i}:00–${i + 1}:00` : "—";
  };

  const left = () => {
    const end = focusEnd();
    if (!end) return "";
    const s = Math.max(0, Math.round((end - now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const focus = (m: number) =>
    startFocus(m, () => {
      notify(`Фокус ${m} мин закончен 🎉 Встаньте, разомнитесь, попейте воды.`);
      try {
        new Notification("Tulpar", { body: `Фокус ${m} мин закончен — время перерыва` });
      } catch {
        /* уведомления выключены */
      }
    });

  return (
    <div class="tool stats">
      <div class="stats-cards">
        <div class="stats-card">
          <b>{formatMinutes(minutesOf(today()))}</b>
          <span>сегодня</span>
        </div>
        <div class="stats-card">
          <b>{formatMinutes(weekTotal())}</b>
          <span>за 7 дней</span>
        </div>
        <div class="stats-card">
          <b>🔥 {streak(stats())}</b>
          <span>дней подряд</span>
        </div>
        <div class="stats-card">
          <b>{today()?.edits ?? 0}</b>
          <span>правок сегодня</span>
        </div>
      </div>

      <div class="tool-sub">Последние 14 дней</div>
      <div class="stats-bars">
        <For each={days()}>
          {(d) => (
            <div class="stats-bar" title={`${d.label}: ${formatMinutes(d.minutes)}`}>
              <div class="fill" style={{ height: `${(d.minutes / max()) * 100}%` }} />
              <span>{d.label}</span>
            </div>
          )}
        </For>
      </div>

      <div class="stats-split">
        <div>
          <div class="tool-sub">Языки</div>
          <For each={langs()} fallback={<div class="dim small">Начните писать код — тут появятся языки.</div>}>
            {([l, m]) => (
              <div class="stats-lang">
                <span data-no-translate>{l}</span>
                <div class="track"><div class="fill" style={{ width: `${(m / langMax()) * 100}%` }} /></div>
                <span class="dim">{formatMinutes(m)}</span>
              </div>
            )}
          </For>
          <div class="dim small">Самое продуктивное время: {bestHour()}</div>
        </div>
        <div>
          <div class="tool-sub">Фокус-таймер</div>
          <Show
            when={focusEnd()}
            fallback={
              <div class="tool-row">
                <button onClick={() => focus(25)}>🍅 25 мин</button>
                <button onClick={() => focus(50)}>50 мин</button>
                <button onClick={() => focus(5)}>☕ Перерыв 5</button>
              </div>
            }
          >
            <div class="stats-focus">
              <b>{left()}</b>
              <button onClick={stopFocus}>Остановить</button>
            </div>
          </Show>
          <div class="dim small">Считаются только минуты, когда вы правите код. Данные хранятся только на этом компьютере.</div>
          <button class="link small" onClick={() => resetStats()}>Сбросить статистику</button>
        </div>
      </div>
    </div>
  );
}
