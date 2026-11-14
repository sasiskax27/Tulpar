// Сборка ролика из записи: код печатается сам в цветах темы Tulpar,
// рисуем кадры на <canvas> и пишем видео через MediaRecorder.
import { monaco } from "../editor/monaco";
import { paletteOf } from "../app/themes";
import { settings } from "../config/store";
import type { Recording } from "./recorder";
import type { Palette } from "../extensions/vscodeTheme";

export interface VideoOptions {
  title: string;
  seconds: number;
  vertical: boolean;
  showWatermark: boolean;
}

interface Step {
  path: string;
  offset: number;
  deleteLen: number;
  text: string;
}

/** Правки → шаги «печати»: большие вставки дробим, чтобы код печатался, а не появлялся целиком. */
export function buildSteps(rec: Recording, budget: number): Step[] {
  const totalChars = rec.ops.reduce((n, o) => n + o.text.length, 0) || 1;
  const chunk = Math.max(1, Math.ceil(totalChars / Math.max(1, budget - rec.ops.length * 0.3)));
  const steps: Step[] = [];
  for (const op of rec.ops) {
    if (op.text.length <= chunk) {
      steps.push({ path: op.path, offset: op.offset, deleteLen: op.deleteLen, text: op.text });
      continue;
    }
    for (let i = 0; i < op.text.length; i += chunk) {
      steps.push({ path: op.path, offset: op.offset + i, deleteLen: i === 0 ? op.deleteLen : 0, text: op.text.slice(i, i + chunk) });
    }
  }
  return steps;
}

function colorFor(type: string, p: Palette): string {
  if (type.includes("comment")) return p.com;
  if (type.includes("string")) return p.str;
  if (type.includes("number")) return p.num;
  if (type.includes("keyword")) return p.kw;
  if (type.includes("type") || type.includes("tag")) return p.type;
  if (type.includes("delimiter") || type.includes("operator")) return p.punct;
  if (type.includes("attribute") || type.includes("predefined")) return p.fn;
  return p.text;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapTitle(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Состояние документов во время проигрывания. */
export class Player {
  docs: Record<string, string> = {};
  current: string;
  cursor = 0;
  private i = 0;

  constructor(private rec: Recording, readonly steps: Step[]) {
    for (const [path, f] of Object.entries(rec.files)) this.docs[path] = f.initial;
    this.current = steps[0]?.path ?? Object.keys(rec.files)[0] ?? "";
  }

  get done() {
    return this.i >= this.steps.length;
  }

  get progress() {
    return this.steps.length ? this.i / this.steps.length : 1;
  }

  /** Применить шаги до доли progress (0..1). */
  advanceTo(progress: number) {
    const target = Math.min(this.steps.length, Math.floor(progress * this.steps.length));
    while (this.i < target) {
      const s = this.steps[this.i++];
      const doc = this.docs[s.path] ?? "";
      this.docs[s.path] = doc.slice(0, s.offset) + s.text + doc.slice(s.offset + s.deleteLen);
      this.current = s.path;
      this.cursor = s.offset + s.text.length;
    }
  }

  language(path: string) {
    return this.rec.files[path]?.language ?? "plaintext";
  }
}

/** Нарисовать кадр. */
export function drawFrame(ctx: CanvasRenderingContext2D, player: Player, opts: VideoOptions, blink: boolean) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const p = paletteOf(String(settings()["workbench.colorTheme"]));
  const mono = `"JetBrains Mono", "Cascadia Code", Consolas, monospace`;

  // Фон с мягким свечением акцентного цвета
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, H * 0.05, 10, W * 0.8, H * 0.05, W * 0.9);
  glow.addColorStop(0, p.accent + "55");
  glow.addColorStop(1, p.accent + "00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const pad = opts.vertical ? 60 : 80;
  let top = opts.vertical ? 120 : 60;

  // Заголовок
  if (opts.title.trim()) {
    ctx.fillStyle = p.strong;
    ctx.font = `800 ${opts.vertical ? 64 : 54}px system-ui, "Segoe UI", sans-serif`;
    const lines = wrapTitle(ctx, opts.title.trim(), W - pad * 2);
    for (const l of lines) {
      top += opts.vertical ? 76 : 64;
      ctx.fillText(l, pad, top);
    }
    top += opts.vertical ? 50 : 36;
  }

  // Окно редактора
  const winX = pad;
  const winY = top;
  const winW = W - pad * 2;
  const winH = H - top - (opts.vertical ? 230 : 110);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = p.code;
  roundRect(ctx, winX, winY, winW, winH, 28);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 2;
  roundRect(ctx, winX, winY, winW, winH, 28);
  ctx.stroke();

  // Шапка окна: точки и имя файла
  const headH = 76;
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(winX + 40 + i * 34, winY + headH / 2, 11, 0, Math.PI * 2);
    ctx.fill();
  });
  const fileName = player.current.split(/[\\/]/).pop() ?? "";
  ctx.font = `600 28px ${mono}`;
  ctx.fillStyle = p.muted;
  ctx.fillText(fileName, winX + 160, winY + headH / 2 + 10);
  ctx.fillStyle = p.line;
  ctx.fillRect(winX, winY + headH, winW, 2);

  // Код
  const text = player.docs[player.current] ?? "";
  const fontSize = opts.vertical ? 30 : 28;
  const lineH = Math.round(fontSize * 1.55);
  ctx.font = `${fontSize}px ${mono}`;
  const charW = ctx.measureText("M").width;
  const codeX = winX + 96;
  const codeY = winY + headH + 40;
  const visible = Math.floor((winH - headH - 60) / lineH);
  const lines = text.split("\n");
  const before = text.slice(0, player.cursor);
  const cursorLine = before.split("\n").length - 1;
  const cursorCol = before.length - (before.lastIndexOf("\n") + 1);
  const first = Math.max(0, Math.min(cursorLine - Math.floor(visible * 0.6), lines.length - visible));
  const maxCols = Math.floor((winW - 96 - 40) / charW);

  // Подсветка: токенизируем с запасом строк сверху, чтобы многострочные строки/комментарии красились верно
  const from = Math.max(0, first - 40);
  const chunk = lines.slice(from, first + visible).join("\n");
  let tokens: monaco.Token[][] = [];
  try {
    tokens = monaco.editor.tokenize(chunk, player.language(player.current));
  } catch {
    tokens = [];
  }

  // Строка с курсором
  if (cursorLine >= first && cursorLine < first + visible) {
    ctx.fillStyle = p.accent + "14";
    ctx.fillRect(winX + 2, codeY + (cursorLine - first) * lineH - fontSize * 1.05, winW - 4, lineH);
  }

  for (let i = 0; i < visible && first + i < lines.length; i++) {
    const n = first + i;
    const y = codeY + i * lineH;
    ctx.fillStyle = p.muted + "99";
    ctx.textAlign = "right";
    ctx.fillText(String(n + 1), codeX - 26, y);
    ctx.textAlign = "left";
    const line = lines[n].replace(/\t/g, "    ").slice(0, maxCols);
    const lineTokens = tokens[n - from] ?? [];
    if (!lineTokens.length) {
      ctx.fillStyle = p.text;
      ctx.fillText(line, codeX, y);
      continue;
    }
    for (let t = 0; t < lineTokens.length; t++) {
      const start = lineTokens[t].offset;
      const end = t + 1 < lineTokens.length ? lineTokens[t + 1].offset : line.length;
      if (start >= line.length) break;
      ctx.fillStyle = colorFor(lineTokens[t].type, p);
      ctx.fillText(line.slice(start, end), codeX + start * charW, y);
    }
  }

  // Курсор
  if (!player.done || blink) {
    if (cursorLine >= first && cursorLine < first + visible) {
      ctx.fillStyle = p.accent;
      ctx.fillRect(codeX + Math.min(cursorCol, maxCols) * charW, codeY + (cursorLine - first) * lineH - fontSize * 0.95, 4, fontSize * 1.2);
    }
  }

  // Низ: прогресс и подпись
  const barY = winY + winH + (opts.vertical ? 70 : 40);
  ctx.fillStyle = p.line;
  roundRect(ctx, pad, barY, W - pad * 2, 10, 5);
  ctx.fill();
  ctx.fillStyle = p.accent;
  roundRect(ctx, pad, barY, Math.max(10, (W - pad * 2) * player.progress), 10, 5);
  ctx.fill();
  if (opts.showWatermark) {
    ctx.font = `700 ${opts.vertical ? 34 : 28}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillStyle = p.muted;
    ctx.textAlign = "center";
    ctx.fillText("сделано в Tulpar 🐎", W / 2, barY + (opts.vertical ? 80 : 56));
    ctx.textAlign = "left";
  }
}

const MIME_CANDIDATES = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

export function bestMime(): string {
  return MIME_CANDIDATES.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

/** Записать ролик. onFrame — для предпросмотра прогресса. */
export async function renderVideo(
  canvas: HTMLCanvasElement,
  rec: Recording,
  opts: VideoOptions,
  onProgress: (p: number) => void,
  signal: { cancelled: boolean },
): Promise<{ blob: Blob; mime: string } | null> {
  const fps = 30;
  canvas.width = opts.vertical ? 1080 : 1920;
  canvas.height = opts.vertical ? 1920 : 1080;
  const ctx = canvas.getContext("2d")!;
  const typing = Math.max(3, opts.seconds - 2.5);
  const steps = buildSteps(rec, Math.floor(typing * fps * 1.4));
  const player = new Player(rec, steps);
  const mime = bestMime();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

  drawFrame(ctx, player, opts, true);
  recorder.start(500);
  const start = performance.now();
  const intro = 0.6;
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (signal.cancelled) return resolve();
      const t = (performance.now() - start) / 1000;
      const typed = Math.min(1, Math.max(0, (t - intro) / typing));
      player.advanceTo(typed);
      drawFrame(ctx, player, opts, Math.floor(t * 2) % 2 === 0);
      onProgress(Math.min(1, t / opts.seconds));
      if (t >= opts.seconds) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  await stopped;
  if (signal.cancelled) return null;
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), mime };
}
