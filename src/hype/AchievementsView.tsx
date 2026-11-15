// 🏆 Все ачивки: открытые и ещё нет.
import { For } from "solid-js";
import { ACHIEVEMENTS, unlocked } from "./achievements";

export default function AchievementsView() {
  const done = () => ACHIEVEMENTS.filter((a) => unlocked()[a.id]).length;
  return (
    <div class="tool achievements">
      <div class="ach-progress">
        <b>{done()} / {ACHIEVEMENTS.length}</b>
        <div class="track"><div class="fill" style={{ width: `${(done() / ACHIEVEMENTS.length) * 100}%` }} /></div>
      </div>
      <div class="ach-grid">
        <For each={ACHIEVEMENTS}>
          {(a) => {
            const at = () => unlocked()[a.id];
            return (
              <div class="ach-card" classList={{ got: !!at() }}>
                <div class="ach-big">{at() || !a.secret ? a.icon : "❓"}</div>
                <b>{at() || !a.secret ? a.title : "Секретное"}</b>
                <span class="dim small">{at() || !a.secret ? a.hint : "Откроется само, когда случится"}</span>
                {at() ? <span class="small ok">{new Date(at()).toLocaleDateString()}</span> : null}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
