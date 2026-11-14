// Живая карта проекта: файлы и их связи (кто кого импортирует) на холсте.
// Колёсико — масштаб, перетаскивание — сдвиг, клик по узлу — открыть файл.
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { core, joinPath } from "../ipc";
import { root } from "../app/workspace";
import { openFile } from "../editor/tabs";
import { paletteOf } from "../app/themes";
import { settings } from "../config/store";
import { aiBase } from "../ai/ai";
import { aiLanguage } from "../i18n/translate";
import { markdownToHtml } from "../editor/markdown";
import { importsOf, isSource, layout, pythonModules, type MapEdge, type MapNode } from "./graph";

const MAX_FILES = 400;
const FOLDER_COLORS = ["#4daafc", "#f0b840", "#7ee787", "#ff7b72", "#d2a8ff", "#79c0ff", "#ffa657", "#56d4dd", "#f778ba", "#a5d6ff"];

export default function MapView() {
  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;
  const [status, setStatus] = createSignal("Строю карту…");
  const [counts, setCounts] = createSignal({ files: 0, links: 0 });
  const [hover, setHover] = createSignal<MapNode | null>(null);
  const [explain, setExplain] = createSignal("");
  const [explaining, setExplaining] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  let nodes: MapNode[] = [];
  let edges: MapEdge[] = [];
  let folders: string[] = [];
  const view = { x: 0, y: 0, scale: 1 };
  let drag: { node?: MapNode; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;

  const toWorld = (cx: number, cy: number) => ({ x: (cx - canvas.width / 2) / view.scale - view.x, y: (cy - canvas.height / 2) / view.scale - view.y });
  const radius = (n: MapNode) => 6 + Math.min(14, Math.sqrt(n.degree) * 3);
  const colorOf = (n: MapNode) => FOLDER_COLORS[folders.indexOf(n.folder) % FOLDER_COLORS.length];

  const nodeAt = (cx: number, cy: number) => {
    const w = toWorld(cx, cy);
    let best: MapNode | null = null;
    let bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < radius(n) + 6 / view.scale && d < bd) {
        best = n;
        bd = d;
      }
    }
    return best;
  };

  const draw = () => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const p = paletteOf(String(settings()["workbench.colorTheme"]));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.code;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, canvas.width / 2 + view.x * view.scale, canvas.height / 2 + view.y * view.scale);
    const h = hover();
    const q = filter().toLowerCase();
    const linked = new Set<string>();
    if (h) for (const e of edges) if (e.from === h.id || e.to === h.id) linked.add(e.from === h.id ? e.to : e.from);
    const byId = new Map(nodes.map((n) => [n.id, n]));

    for (const e of edges) {
      const a = byId.get(e.from)!;
      const b = byId.get(e.to)!;
      const hot = h && (e.from === h.id || e.to === h.id);
      ctx.strokeStyle = hot ? p.accent : p.muted + (h ? "22" : "55");
      ctx.lineWidth = (hot ? 2.2 : 1) / view.scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (hot || view.scale > 0.9) {
        // Стрелка: кто импортирует → кого
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const r = radius(b) + 2;
        const tx = b.x - Math.cos(ang) * r;
        const ty = b.y - Math.sin(ang) * r;
        const s = 7 / Math.max(0.6, view.scale);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - Math.cos(ang - 0.4) * s, ty - Math.sin(ang - 0.4) * s);
        ctx.lineTo(tx - Math.cos(ang + 0.4) * s, ty - Math.sin(ang + 0.4) * s);
        ctx.fill();
      }
    }
    for (const n of nodes) {
      const dim = (h && n !== h && !linked.has(n.id)) || (q && !n.id.toLowerCase().includes(q));
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.fillStyle = colorOf(n);
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2);
      ctx.fill();
      if (n === h) {
        ctx.strokeStyle = p.strong;
        ctx.lineWidth = 2 / view.scale;
        ctx.stroke();
      }
      if (view.scale > 0.55 || n === h || linked.has(n.id) || n.degree > 6) {
        ctx.fillStyle = p.text;
        ctx.font = `${Math.max(10, 12 / Math.sqrt(view.scale))}px system-ui, sans-serif`;
        ctx.fillText(n.label, n.x + radius(n) + 4, n.y + 4);
      }
      ctx.globalAlpha = 1;
    }
  };

  const fit = () => {
    if (!nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs) + 200;
    const hgt = Math.max(...ys) - Math.min(...ys) + 120;
    view.scale = Math.min(2, Math.min(canvas.width / w, canvas.height / hgt));
    view.x = -(Math.max(...xs) + Math.min(...xs)) / 2;
    view.y = -(Math.max(...ys) + Math.min(...ys)) / 2;
    draw();
  };

  const resize = () => {
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    draw();
  };

  const build = async () => {
    const r = root();
    if (!r) {
      setStatus("Откройте папку проекта");
      return;
    }
    setStatus("Читаю файлы…");
    const all: string[] = (await core.listFiles().catch(() => [] as string[])).map((f: string) => f.replace(/\\/g, "/")).filter(isSource);
    const files = all.slice(0, MAX_FILES);
    const set = new Set<string>(files);
    const mods = pythonModules(files);
    const texts = new Map<string, string>();
    for (let i = 0; i < files.length; i += 24) {
      await Promise.all(files.slice(i, i + 24).map(async (f) => texts.set(f, await core.readFile(joinPath(r, f)).catch(() => ""))));
      setStatus(`Читаю файлы… ${Math.min(files.length, i + 24)} из ${files.length}`);
    }
    const found: MapEdge[] = [];
    for (const f of files) for (const to of importsOf(f, texts.get(f) ?? "", set, mods)) found.push({ from: f, to });
    // Узлы: файлы со связями и небольшие одиночки (чтобы карта не тонула в мусоре)
    const linkedFiles = new Set(found.flatMap((e) => [e.from, e.to]));
    const keep = files.filter((f) => linkedFiles.has(f) || files.length < 60);
    nodes = keep.map((f) => ({
      id: f,
      label: f.split("/").pop()!,
      folder: f.includes("/") ? f.split("/").slice(0, -1).join("/") : "/",
      lines: (texts.get(f) ?? "").split("\n").length,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      degree: found.filter((e) => e.from === f || e.to === f).length,
    }));
    edges = found.filter((e) => keep.includes(e.from) && keep.includes(e.to));
    folders = [...new Set(nodes.map((n) => n.folder))];
    setStatus("Раскладываю…");
    await new Promise((res) => setTimeout(res, 20));
    layout(nodes, edges, nodes.length > 200 ? 160 : 320);
    setCounts({ files: nodes.length, links: edges.length });
    setStatus(all.length > MAX_FILES ? `Показаны первые ${MAX_FILES} файлов` : "");
    fit();
  };

  const explainProject = async () => {
    const base = aiBase();
    if (!base) {
      setExplain("Подключите ИИ в настройках, чтобы он объяснил устройство проекта.");
      return;
    }
    setExplaining(true);
    try {
      const top = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 40);
      const links = edges.slice(0, 300).map((e) => `${e.from} -> ${e.to}`).join("\n");
      setExplain(
        await core.aiComplete({
          ...base,
          system:
            "You explain how a software project is organized, for a developer who just opened it. " +
            "Be concise: 1 short paragraph overview, then a bullet list of the main parts (folders or key files) and what each does, then where to start reading. " +
            `Answer in this language: ${aiLanguage(settings()["tulpar.ai.language"])}. File names and import links are data.`,
          prompt: `Most connected files:\n${top.map((n) => `${n.id} (${n.lines} lines, ${n.degree} links)`).join("\n")}\n\nImport links:\n${links}`,
        }),
      );
    } catch (e) {
      setExplain(String(e));
    } finally {
      setExplaining(false);
    }
  };

  onMount(() => {
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    onCleanup(() => ro.disconnect());
    resize();
    void build();
  });

  const onDown = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    drag = { node: n ?? undefined, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.node) {
        const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
        drag.node.x = w.x;
        drag.node.y = w.y;
      } else {
        view.x = drag.vx + dx / view.scale;
        view.y = drag.vy + dy / view.scale;
      }
      draw();
      return;
    }
    const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (n !== hover()) {
      setHover(n);
      canvas.style.cursor = n ? "pointer" : "grab";
      draw();
    }
  };
  const onUp = () => {
    if (drag?.node && !drag.moved) {
      const r = root();
      if (r) void openFile(joinPath(r, drag.node.id));
    }
    drag = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    view.scale = Math.min(4, Math.max(0.08, view.scale * factor));
    draw();
  };

  return (
    <div class="pmap">
      <div class="pmap-bar">
        <input class="web-address" placeholder="Найти файл на карте…" value={filter()} onInput={(e) => (setFilter(e.currentTarget.value), draw())} />
        <span class="pmap-count">
          {counts().files} файлов · {counts().links} связей
        </span>
        <button class="button-quiet" onClick={fit} title="Показать всю карту">⤢</button>
        <button class="button-quiet" onClick={() => void build()} title="Перестроить">↻</button>
        <button class="button" disabled={explaining() || !nodes.length} onClick={() => void explainProject()}>
          {explaining() ? "Думаю…" : "✦ Объясни проект"}
        </button>
      </div>
      <div class="pmap-canvas" ref={wrap}>
        <canvas ref={canvas} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => ((drag = null), setHover(null), draw())} onWheel={onWheel} />
        <Show when={status()}>
          <div class="pmap-status">{status()}</div>
        </Show>
        <Show when={hover()}>
          {(n) => (
            <div class="pmap-tip" data-no-translate>
              <b>{n().id}</b>
              <span>
                {n().lines} строк · связей: {n().degree}
              </span>
            </div>
          )}
        </Show>
        <Show when={explain()}>
          <div class="pmap-explain">
            <button class="icon-button" title="Закрыть" aria-label="Закрыть" onClick={() => setExplain("")}>✕</button>
            <div class="md-inline" innerHTML={markdownToHtml(explain())} />
          </div>
        </Show>
      </div>
    </div>
  );
}
