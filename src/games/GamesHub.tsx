// 🎮 Все игры в одном месте.
import { For } from "solid-js";
import { executeCommand } from "../commands/registry";
import { ACHIEVEMENTS, unlocked } from "../hype/achievements";

const GAMES: { cmd: string; icon: string; title: string; text: string }[] = [
  { cmd: "tulpar.battle", icon: "⚔️", title: "Битва с ИИ", text: "Одна задача — кто решит быстрее, вы или ИИ" },
  { cmd: "tulpar.game.bughunt", icon: "🐞", title: "Найди баг", text: "ИИ прячет ошибку в коде — найдите строку" },
  { cmd: "tulpar.game.typing", icon: "⌨️", title: "Скоростная печать", text: "Печатайте настоящий код на скорость" },
  { cmd: "tulpar.game.quiz", icon: "🧠", title: "Викторина", text: "5 вопросов от ИИ на любую тему" },
  { cmd: "tulpar.game.snake", icon: "🐍", title: "Змейка", text: "Пока идёт сборка — ешьте скобки" },
  { cmd: "tulpar.roast", icon: "😈", title: "Прожарка кода", text: "ИИ смешно разносит ваш файл" },
  { cmd: "tulpar.achievements", icon: "🏆", title: "Достижения", text: "" },
];

export default function GamesHub() {
  const got = () => ACHIEVEMENTS.filter((a) => unlocked()[a.id]).length;
  return (
    <div class="tool games-hub">
      <div class="games-grid">
        <For each={GAMES}>
          {(g) => (
            <button class="game-card" onClick={() => void executeCommand(g.cmd)}>
              <span class="game-icon">{g.icon}</span>
              <b>{g.title}</b>
              <span class="dim small">{g.cmd === "tulpar.achievements" ? `Открыто ${got()} из ${ACHIEVEMENTS.length}` : g.text}</span>
            </button>
          )}
        </For>
      </div>
      <div class="dim small">А ещё: ⚡ Power mode, 🎧 музыка и 📸 скриншоты кода — в строке статуса и в разделе «Игры и фан» палитры команд.</div>
    </div>
  );
}
