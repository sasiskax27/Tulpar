// 🏆 Ачивки: красивые всплывашки за маленькие победы. Всё локально.
import { createSignal } from "solid-js";
import { t } from "../i18n/translate";

export interface Achievement {
  id: string;
  icon: string;
  title: string;
  hint: string;
  secret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-file", icon: "📄", title: "Начало пути", hint: "Сохранить первый файл" },
  { id: "saves-100", icon: "💾", title: "Ctrl+S-маньяк", hint: "Сохранить файлы 100 раз" },
  { id: "lines-100", icon: "✍️", title: "Сотка", hint: "Написать 100 строк за день" },
  { id: "lines-1000", icon: "📜", title: "Тысячник", hint: "Написать 1000 строк всего" },
  { id: "minutes-60", icon: "⏱", title: "Час в потоке", hint: "Писать код 60 минут за день" },
  { id: "streak-3", icon: "🔥", title: "Огонь", hint: "Кодить 3 дня подряд" },
  { id: "streak-7", icon: "🌋", title: "Вулкан", hint: "Кодить 7 дней подряд" },
  { id: "night-owl", icon: "🦉", title: "Ночной кодер", hint: "Писать код после 2:00 ночи", secret: true },
  { id: "early-bird", icon: "🐦", title: "Ранняя пташка", hint: "Писать код до 7:00 утра", secret: true },
  { id: "polyglot", icon: "🌍", title: "Полиглот", hint: "Писать на 5 разных языках" },
  { id: "first-commit", icon: "🌱", title: "Первый коммит", hint: "Сделать коммит в Tulpar" },
  { id: "bug-hunter", icon: "🐞", title: "Охотник на баги", hint: "Исправить ошибку с помощью ИИ" },
  { id: "first-ai", icon: "🤖", title: "Напарник", hint: "Задать вопрос ИИ" },
  { id: "focus-done", icon: "🍅", title: "Помидорка", hint: "Завершить фокус-сессию" },
  { id: "battle-win", icon: "🏆", title: "Победил машину", hint: "Выиграть битву с ИИ" },
  { id: "battle-5", icon: "⚔️", title: "Гладиатор", hint: "Сыграть 5 битв с ИИ" },
  { id: "collab", icon: "👥", title: "Командная игра", hint: "Покодить вместе по сети" },
  { id: "roasted", icon: "😈", title: "Прожарен", hint: "Пережить прожарку кода" },
  { id: "snapshot", icon: "📸", title: "Фотограф", hint: "Сделать красивый скриншот кода" },
  { id: "power-mode", icon: "⚡", title: "Режим бога", hint: "Включить Power mode" },
  { id: "dj", icon: "🎧", title: "Диджей", hint: "Включить музыку в редакторе" },
  { id: "voice", icon: "🗣", title: "Говорящий кодер", hint: "Написать код голосом" },
  { id: "presenter", icon: "🎤", title: "Спикер", hint: "Включить режим презентации" },
  { id: "learner", icon: "🎓", title: "Ученик", hint: "Пройти урок в учебном режиме" },
  { id: "time-traveler", icon: "⏳", title: "Путешественник во времени", hint: "Восстановить старую версию файла" },
];

const KEY = "tulpar.achievements";
const COUNTERS = "tulpar.achievements.counters";

function load<T>(key: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  } catch {
    return fallback;
  }
}

const [unlocked, setUnlocked] = createSignal<Record<string, number>>(load(KEY, {}));
export { unlocked };
const counters: Record<string, number> = load(COUNTERS, {});

export function unlock(id: string) {
  if (unlocked()[id]) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  const next = { ...unlocked(), [id]: Date.now() };
  setUnlocked(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ничего */
  }
  toast(a);
}

/** Счётчик с порогами: count("saves", 1, {1: "first-file", 100: "saves-100"}). */
export function count(name: string, by = 1, thresholds: Record<number, string> = {}) {
  counters[name] = (counters[name] ?? 0) + by;
  for (const [n, id] of Object.entries(thresholds)) if (counters[name] >= Number(n)) unlock(id);
  try {
    localStorage.setItem(COUNTERS, JSON.stringify(counters));
  } catch {
    /* ничего */
  }
}

export const counter = (name: string) => counters[name] ?? 0;

// ---------- Всплывашка ----------
let stack: HTMLDivElement | null = null;
function toast(a: Achievement) {
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "ach-stack";
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = "ach-toast";
  el.innerHTML = `<div class="ach-icon"></div><div><div class="ach-label"></div><div class="ach-title"></div><div class="ach-hint"></div></div>`;
  (el.querySelector(".ach-icon") as HTMLElement).textContent = a.icon;
  (el.querySelector(".ach-label") as HTMLElement).textContent = t("🏆 Достижение открыто!");
  (el.querySelector(".ach-title") as HTMLElement).textContent = t(a.title);
  (el.querySelector(".ach-hint") as HTMLElement).textContent = t(a.hint);
  el.setAttribute("data-no-translate", "");
  stack.appendChild(el);
  // Конфетти
  for (let i = 0; i < 18; i++) {
    const c = document.createElement("i");
    c.className = "ach-confetti";
    c.style.setProperty("--x", `${(Math.random() - 0.5) * 260}px`);
    c.style.setProperty("--y", `${-60 - Math.random() * 120}px`);
    c.style.setProperty("--r", `${Math.random() * 720}deg`);
    c.style.background = ["#ffb224", "#e5484d", "#30a46c", "#0090ff", "#8e4ec6"][i % 5];
    el.appendChild(c);
  }
  setTimeout(() => el.classList.add("out"), 4500);
  setTimeout(() => el.remove(), 5200);
}
