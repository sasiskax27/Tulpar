// 📸 Красивый скриншот кода: подсветка как в редакторе, градиентный фон,
// окно с «светофором» и подпись made in Tulpar.
import { createSignal } from "solid-js";
import { editorInstance } from "../editor/instance";
import { monaco } from "../editor/monaco";
import { activePath } from "../editor/tabs";
import { baseName } from "../ipc";
import { notify } from "../app/notify";
import { unlock } from "./achievements";

export const GRADIENTS: [string, string, string][] = [
  ["Закат", "#ff7e5f", "#feb47b"],
  ["Степь", "#f6d365", "#fda085"],
  ["Небо KZ", "#00b4db", "#0083b0"],
  ["Аврора", "#43cea2", "#185a9d"],
  ["Неон", "#b721ff", "#21d4fd"],
  ["Вишня", "#eb3349", "#f45c43"],
  ["Ночь", "#232526", "#414345"],
];

export interface SnapOptions {
  gradient: number;
  padding: number;
  watermark: boolean;
  title: string;
}

interface Run { text: string; color: string }

const [snapSource, setSnapSource] = createSignal<{ lines: Run[][]; title: string; bg: string; fg: string; font: string } | null>(null);
export { snapSource, setSnapSource };

/** Взять выделение (или видимую часть) и раскрасить как в редакторе. */
export async function captureSelection(): Promise<boolean> {
  const editor = editorInstance();
  const model = editor?.getModel();
  if (!editor || !model) {
    notify("Откройте файл и выделите код");
    return false;
  }
  const sel = editor.getSelection();
  let range: monaco.IRange;
  if (sel && !sel.isEmpty()) range = { startLineNumber: sel.startLineNumber, startColumn: 1, endLineNumber: sel.endLineNumber, endColumn: model.getLineMaxColumn(sel.endLineNumber) };
  else {
    const vis = editor.getVisibleRanges()[0];
    const start = vis?.startLineNumber ?? 1;
    const end = Math.min(model.getLineCount(), start + 24);
    range = { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: model.getLineMaxColumn(end) };
  }
  const raw = model.getValueInRange(range).replace(/\t/g, "  ");
  // Общий отступ убираем — на картинке код начинается от края
  const lines0 = raw.split(/\r?\n/).slice(0, 80);
  const indent = Math.min(...lines0.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  const text = lines0.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");

  const html = await monaco.editor.colorize(text, model.getLanguageId(), { tabSize: 2 });
  const host = document.createElement("div");
  host.className = "monaco-editor snap-measure";
  host.innerHTML = html;
  document.body.appendChild(host);
  const lines: Run[][] = [[]];
  const walk = (node: Node, color: string) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeName === "BR") lines.push([]);
      else if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? "").replace(/ /g, " ").split("\n");
        parts.forEach((p, i) => {
          if (i) lines.push([]);
          if (p) lines[lines.length - 1].push({ text: p, color });
        });
      } else if (child instanceof HTMLElement) walk(child, getComputedStyle(child).color || color);
    }
  };
  const editorDom = editor.getDomNode()!;
  const style = getComputedStyle(editorDom.querySelector(".monaco-editor-background") ?? editorDom);
  walk(host, getComputedStyle(editorDom).color || "#ddd");
  host.remove();
  while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  const opts = editor.getOption(monaco.editor.EditorOption.fontInfo);
  setSnapSource({ lines, title: baseName(activePath() ?? "code"), bg: style.backgroundColor || "#1e1e1e", fg: "#ddd", font: opts.fontFamily });
  return true;
}

export function renderSnapshot(canvas: HTMLCanvasElement, o: SnapOptions) {
  const src = snapSource();
  if (!src) return;
  const scale = 2;
  const fontSize = 15;
  const lineH = 22;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontSize}px ${src.font}`;
  const charW = ctx.measureText("M").width;
  const maxLen = Math.max(20, ...src.lines.map((l) => l.reduce((a, r) => a + r.text.length, 0)));
  const winW = Math.ceil(maxLen * charW + 48);
  const winH = src.lines.length * lineH + 48 + 36;
  const W = winW + o.padding * 2;
  const H = winH + o.padding * 2 + (o.watermark ? 10 : 0);
  canvas.width = W * scale;
  canvas.height = H * scale;
  ctx.scale(scale, scale);
  const [, c1, c2] = GRADIENTS[o.gradient] ?? GRADIENTS[0];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Окно
  const x = o.padding, y = o.padding;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = src.bg;
  ctx.beginPath();
  ctx.roundRect(x, y, winW, winH, 12);
  ctx.fill();
  ctx.restore();
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x + 22 + i * 20, y + 20, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.font = `13px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(o.title || src.title, x + winW / 2, y + 24);
  ctx.textAlign = "left";
  ctx.font = `${fontSize}px ${src.font}`;
  ctx.textBaseline = "middle";
  src.lines.forEach((line, i) => {
    let cx = x + 24;
    const cy = y + 36 + 18 + i * lineH;
    for (const r of line) {
      ctx.fillStyle = r.color;
      ctx.fillText(r.text, cx, cy);
      cx += r.text.length * charW;
    }
  });
  if (o.watermark) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.textAlign = "right";
    ctx.fillText("made in Tulpar 🐎", W - 14, H - 12);
  }
  unlock("snapshot");
}
