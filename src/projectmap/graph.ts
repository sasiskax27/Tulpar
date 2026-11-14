// Граф проекта: файлы — узлы, импорты — связи. Понимает JS/TS, Python,
// Go, Rust (mod/use crate::), CSS @import и HTML-ссылки на свои файлы.

export interface MapNode {
  id: string;
  label: string;
  folder: string;
  lines: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

export interface MapEdge {
  from: string;
  to: string;
}

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|css|scss|html?)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|target|\.git|\.venv|venv|__pycache__|\.next|out|coverage)\//;

export const isSource = (rel: string) => SOURCE.test(rel) && !SKIP.test(rel.replace(/\\/g, "/"));

function dirOf(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Найти файл проекта по пути импорта (с подбором расширений и index-файлов). */
function resolveImport(fromFile: string, spec: string, files: Set<string>, exts: string[]): string | null {
  const base = normalize(`${dirOf(fromFile)}/${spec}`);
  const tries = [base, ...exts.map((e) => base + e), ...exts.map((e) => `${base}/index${e}`)];
  for (const t of tries) if (files.has(t)) return t;
  return null;
}

/** Связи одного файла. */
export function importsOf(rel: string, text: string, files: Set<string>, byModule: Map<string, string>): string[] {
  const out = new Set<string>();
  const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
  const add = (p: string | null) => p && p !== rel && out.add(p);
  if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/.test(ext)) {
    const re = /(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
    for (const m of text.matchAll(re)) {
      const spec = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").split("?")[0];
      if (spec.startsWith(".")) add(resolveImport(rel, spec, files, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".css"]));
      else if (spec.startsWith("@/") || spec.startsWith("~/")) add(resolveImport("src/x", "./" + spec.slice(2), files, [".ts", ".tsx", ".js", ".jsx", ".vue"]));
    }
  } else if (ext === ".py") {
    for (const m of text.matchAll(/^\s*(?:from\s+([.\w]+)\s+import\s+([\w, ]+)|import\s+([\w., ]+))/gm)) {
      const mods = m[1] ? [m[1], ...m[2].split(",").map((x) => `${m[1]}.${x.trim()}`)] : m[3].split(",").map((x) => x.trim().split(" ")[0]);
      for (let mod of mods) {
        if (mod.startsWith(".")) {
          const dots = mod.match(/^\.+/)![0].length;
          let dir = dirOf(rel);
          for (let i = 1; i < dots; i++) dir = dirOf(dir);
          mod = (dir ? dir.replace(/\//g, ".") + "." : "") + mod.slice(dots);
        }
        add(byModule.get(mod) ?? null);
      }
    }
  } else if (ext === ".rs") {
    for (const m of text.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm)) {
      const dir = dirOf(rel);
      const self = rel.endsWith("main.rs") || rel.endsWith("lib.rs") || rel.endsWith("mod.rs") ? dir : rel.slice(0, -3);
      add(files.has(`${self}/${m[1]}.rs`) ? `${self}/${m[1]}.rs` : files.has(`${self}/${m[1]}/mod.rs`) ? `${self}/${m[1]}/mod.rs` : null);
    }
  } else if (ext === ".go") {
    // Пакеты Go: связываем с файлами папки пакета внутри проекта
    for (const m of text.matchAll(/"([\w.\-/]+)"/g)) {
      const last = m[1].split("/").slice(-1)[0];
      for (const f of files) if (f.endsWith(".go") && dirOf(f).endsWith(last) && dirOf(f) !== dirOf(rel)) {
        add(f);
        break;
      }
    }
  } else if (/\.(css|scss)$/.test(ext)) {
    for (const m of text.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) add(resolveImport(rel, m[1], files, [".css", ".scss"]));
  } else if (/\.html?$/.test(ext)) {
    for (const m of text.matchAll(/(?:src|href)=["']([^"':]+\.(?:js|css|ts|mjs))["']/g)) add(resolveImport(rel, "./" + m[1].replace(/^\.\//, ""), files, []));
  }
  return [...out];
}

/** Python: «pkg.mod» → путь файла. */
export function pythonModules(files: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files) {
    if (!f.endsWith(".py")) continue;
    let mod = f.slice(0, -3).replace(/\//g, ".");
    if (mod.endsWith(".__init__")) mod = mod.slice(0, -9);
    map.set(mod, f);
    // src/pkg/mod.py часто импортируют как pkg.mod
    if (mod.startsWith("src.")) map.set(mod.slice(4), f);
  }
  return map;
}

/** Раскладка «пружинами» (Fruchterman–Reingold). */
export function layout(nodes: MapNode[], edges: MapEdge[], iterations = 320) {
  const n = nodes.length;
  if (!n) return;
  const area = 900 * 700 * Math.max(1, n / 40);
  const k = Math.sqrt(area / n);
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  // Начальные позиции — по кругу, папки рядом
  const folders = [...new Set(nodes.map((nd) => nd.folder))];
  nodes.forEach((nd, i) => {
    const f = folders.indexOf(nd.folder);
    const angle = (f / Math.max(1, folders.length)) * Math.PI * 2 + (i % 7) * 0.12;
    const r = k * 2 + (i % 5) * k * 0.4;
    nd.x = Math.cos(angle) * r;
    nd.y = Math.sin(angle) * r;
  });
  let temp = k * 3;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = nodes[i].x - nodes[j].x;
        let ey = nodes[i].y - nodes[j].y;
        let d = Math.hypot(ex, ey) || 0.01;
        // Одна папка — чуть слабее отталкивание: кластеры
        const f = ((k * k) / d) * (nodes[i].folder === nodes[j].folder ? 0.7 : 1.1);
        ex /= d;
        ey /= d;
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const e of edges) {
      const a = index.get(e.from)!;
      const b = index.get(e.to)!;
      let ex = nodes[a].x - nodes[b].x;
      let ey = nodes[a].y - nodes[b].y;
      const d = Math.hypot(ex, ey) || 0.01;
      const f = (d * d) / k;
      ex /= d;
      ey /= d;
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }
    for (let i = 0; i < n; i++) {
      // Лёгкое притяжение к центру — граф не разлетается
      dx[i] -= nodes[i].x * 0.02;
      dy[i] -= nodes[i].y * 0.02;
      const d = Math.hypot(dx[i], dy[i]) || 0.01;
      nodes[i].x += (dx[i] / d) * Math.min(d, temp);
      nodes[i].y += (dy[i] / d) * Math.min(d, temp);
    }
    temp *= 0.985;
  }
}
