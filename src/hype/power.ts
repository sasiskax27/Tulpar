// ⚡ Power mode: искры из-под курсора и лёгкая тряска экрана при быстром наборе.
import { createSignal } from "solid-js";
import { editorInstance } from "../editor/instance";
import { unlock } from "./achievements";

const KEY = "tulpar.powerMode";
const [power, setPower] = createSignal<"off" | "sparks" | "shake">((localStorage.getItem(KEY) as "off" | "sparks" | "shake") || "off");
export { power };

interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }
let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let raf = 0;
let combo = 0;
let comboTimer = 0;
const [comboCount, setComboCount] = createSignal(0);
export { comboCount };

function ensureCanvas() {
  if (canvas) return canvas;
  canvas = document.createElement("canvas");
  canvas.className = "power-canvas";
  document.body.appendChild(canvas);
  const resize = () => {
    canvas!.width = window.innerWidth * devicePixelRatio;
    canvas!.height = window.innerHeight * devicePixelRatio;
  };
  resize();
  window.addEventListener("resize", resize);
  return canvas;
}

function loop() {
  const c = canvas!;
  const ctx = c.getContext("2d")!;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.25;
    p.life -= 1;
    ctx.globalAlpha = Math.max(0, p.life / 40);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  raf = particles.length ? requestAnimationFrame(loop) : 0;
}

function burst() {
  const editor = editorInstance();
  const pos = editor?.getPosition();
  const dom = editor?.getDomNode();
  if (!editor || !pos || !dom) return;
  const v = editor.getScrolledVisiblePosition(pos);
  if (!v) return;
  const rect = dom.getBoundingClientRect();
  const x = rect.left + v.left;
  const y = rect.top + v.top + v.height / 2;
  const colors = combo > 50 ? ["#ff4d4d", "#ffb224", "#fff"] : combo > 20 ? ["#ffb224", "#ffd166", "#fff"] : ["#4cc9f0", "#7b2ff7", "#fff"];
  const n = Math.min(14, 4 + Math.floor(combo / 10));
  for (let i = 0; i < n; i++) {
    particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5 - 1, life: 30 + Math.random() * 15, color: colors[i % colors.length], size: 2 + Math.random() * 2.5 });
  }
  ensureCanvas();
  if (!raf) raf = requestAnimationFrame(loop);
  if (power() === "shake" && combo > 8) {
    const host = dom.closest(".editor-host") as HTMLElement | null ?? dom;
    const s = Math.min(6, 1 + combo / 25);
    host.animate([{ transform: "translate(0,0)" }, { transform: `translate(${(Math.random() - 0.5) * s}px, ${(Math.random() - 0.5) * s}px)` }, { transform: "translate(0,0)" }], { duration: 90 });
  }
}

/** Вызывается на каждую правку в редакторе. */
export function onType() {
  if (power() === "off") return;
  combo++;
  setComboCount(combo);
  clearTimeout(comboTimer);
  comboTimer = window.setTimeout(() => {
    combo = 0;
    setComboCount(0);
  }, 2000);
  burst();
}

export function setPowerMode(mode: "off" | "sparks" | "shake") {
  setPower(mode);
  localStorage.setItem(KEY, mode);
  if (mode !== "off") unlock("power-mode");
}

export function cyclePowerMode() {
  setPowerMode(power() === "off" ? "sparks" : power() === "sparks" ? "shake" : "off");
}
