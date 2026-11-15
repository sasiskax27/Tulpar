// 🐍 Змейка из скобок — пока идёт сборка или npm install.
import { createSignal, onCleanup, onMount } from "solid-js";
import { unlock } from "../hype/achievements";

const N = 20;
const BEST = "tulpar.games.snake.best";
const FOOD = ["{}", "()", "[]", "<>", ";", "=>", "&&", "fn"];

export default function SnakeGame() {
  let canvas!: HTMLCanvasElement;
  const [score, setScore] = createSignal(0);
  const [best, setBest] = createSignal(Number(localStorage.getItem(BEST) ?? 0));
  const [over, setOver] = createSignal(false);
  let snake = [{ x: 10, y: 10 }];
  let dir = { x: 1, y: 0 };
  let nextDir = dir;
  let food = { x: 5, y: 5, s: "{}" };
  let timer = 0;

  const place = () => {
    do food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N), s: FOOD[Math.floor(Math.random() * FOOD.length)] };
    while (snake.some((p) => p.x === food.x && p.y === food.y));
  };

  const draw = () => {
    const ctx = canvas.getContext("2d")!;
    const c = canvas.width / N;
    const css = getComputedStyle(canvas);
    ctx.fillStyle = css.getPropertyValue("--tp-code-bg") || "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${c * 0.6}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffb224";
    ctx.fillText(food.s, food.x * c + c / 2, food.y * c + c / 2);
    snake.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? "#30a46c" : `hsl(${150 - i * 3}, 55%, ${45 - Math.min(20, i)}%)`;
      ctx.beginPath();
      ctx.roundRect(p.x * c + 1, p.y * c + 1, c - 2, c - 2, 5);
      ctx.fill();
    });
  };

  const step = () => {
    dir = nextDir;
    const head = { x: (snake[0].x + dir.x + N) % N, y: (snake[0].y + dir.y + N) % N };
    if (snake.some((p) => p.x === head.x && p.y === head.y)) {
      clearInterval(timer);
      setOver(true);
      if (score() > best()) {
        setBest(score());
        localStorage.setItem(BEST, String(score()));
      }
      return;
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      setScore((s) => s + 1);
      if (score() >= 30) unlock("snake-30");
      place();
      clearInterval(timer);
      timer = window.setInterval(step, Math.max(55, 130 - score() * 3));
    } else snake.pop();
    draw();
  };

  const restart = () => {
    snake = [{ x: 10, y: 10 }];
    dir = nextDir = { x: 1, y: 0 };
    setScore(0);
    setOver(false);
    place();
    clearInterval(timer);
    timer = window.setInterval(step, 130);
    canvas.focus();
  };

  onMount(() => {
    canvas.width = canvas.height = 480;
    restart();
  });
  onCleanup(() => clearInterval(timer));

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, { x: number; y: number }> = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
      ц: { x: 0, y: -1 }, ы: { x: 0, y: 1 }, ф: { x: -1, y: 0 }, в: { x: 1, y: 0 },
    };
    const d = map[e.key];
    if (d && (d.x !== -dir.x || d.y !== -dir.y)) {
      e.preventDefault();
      nextDir = d;
    }
    if (e.key === " " && over()) restart();
  };

  return (
    <div class="tool snake">
      <div class="tool-row">
        <b>Счёт: {score()}</b>
        <span class="dim">Рекорд: {best()}</span>
        <span class="grow" />
        <button onClick={restart}>{over() ? "Ещё раз" : "Заново"}</button>
      </div>
      <canvas ref={canvas} class="snake-canvas" tabindex="0" onKeyDown={onKey} />
      <div class="dim small">{over() ? "Змейка съела себя 😵 Пробел — ещё раз." : "Стрелки или WASD. Ешьте скобки — змейка растёт и ускоряется."}</div>
    </div>
  );
}
