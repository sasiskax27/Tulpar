// Мелкие преобразования для «Инструментов». Всё считается локально.

/** JSON → интерфейсы TypeScript. */
export function jsonToTs(json: string, rootName = "Root"): string {
  const data = JSON.parse(json);
  const out: string[] = [];
  const seen = new Map<string, string>();
  const pascal = (s: string) => (s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) || "Item");
  const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

  function typeOf(v: unknown, name: string): string {
    if (v === null) return "null";
    if (Array.isArray(v)) {
      if (!v.length) return "unknown[]";
      const objs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      if (objs.length === v.length) {
        // Объединяем поля всех элементов: отсутствующие — необязательные
        const merged: Record<string, unknown> = {};
        const counts: Record<string, number> = {};
        for (const o of objs) for (const [k, x] of Object.entries(o)) {
          if (!(k in merged) || merged[k] === null) merged[k] = x;
          counts[k] = (counts[k] ?? 0) + 1;
        }
        const optional = new Set(Object.keys(counts).filter((k) => counts[k] < objs.length));
        return iface(merged, name.replace(/s$/, ""), optional) + "[]";
      }
      const types = [...new Set(v.map((x) => typeOf(x, name)))];
      return types.length === 1 ? `${types[0]}[]` : `(${types.join(" | ")})[]`;
    }
    if (typeof v === "object") return iface(v as Record<string, unknown>, name, new Set());
    return typeof v;
  }

  function iface(obj: Record<string, unknown>, name: string, optional: Set<string>): string {
    const nm = pascal(name);
    const body = Object.entries(obj).map(([k, v]) => `  ${key(k)}${optional.has(k) ? "?" : ""}: ${typeOf(v, k)};`).join("\n");
    const sig = body;
    if (seen.has(sig)) return seen.get(sig)!;
    let unique = nm;
    let n = 2;
    while (out.some((x) => x.startsWith(`export interface ${unique} `))) unique = nm + n++;
    seen.set(sig, unique);
    out.push(`export interface ${unique} {\n${body}\n}`);
    return unique;
  }

  const top = typeOf(data, rootName);
  if (!out.length || top !== pascal(rootName)) out.push(`export type ${pascal(rootName)} = ${top};`);
  return out.join("\n\n");
}

export function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function b64decode(s: string): string {
  const bin = atob(s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function decodeJwt(token: string): string {
  const parts = token.trim().split(".");
  if (parts.length < 2) throw new Error("это не JWT: нужно три части через точку");
  const pad = (p: string) => p + "=".repeat((4 - (p.length % 4)) % 4);
  const header = JSON.parse(b64decode(pad(parts[0])));
  const payload = JSON.parse(b64decode(pad(parts[1])));
  const notes: string[] = [];
  for (const k of ["iat", "nbf", "exp"]) {
    if (typeof payload[k] === "number") notes.push(`${k}: ${new Date(payload[k] * 1000).toLocaleString()}`);
  }
  if (typeof payload.exp === "number") notes.push(payload.exp * 1000 < Date.now() ? "⚠ токен истёк" : "✓ токен ещё действует");
  return `// header\n${JSON.stringify(header, null, 2)}\n\n// payload\n${JSON.stringify(payload, null, 2)}${notes.length ? "\n\n// " + notes.join("\n// ") : ""}`;
}

export async function hashes(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const out: string[] = [];
  for (const alg of ["SHA-1", "SHA-256", "SHA-512"]) {
    const buf = await crypto.subtle.digest(alg, data);
    out.push(`${alg}: ${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  }
  return out.join("\n");
}

export function uuids(n = 5): string {
  return Array.from({ length: n }, () => crypto.randomUUID()).join("\n");
}

export function timeInfo(input: string): string {
  const t = input.trim();
  let d: Date;
  if (!t) d = new Date();
  else if (/^\d{9,11}$/.test(t)) d = new Date(Number(t) * 1000);
  else if (/^\d{12,14}$/.test(t)) d = new Date(Number(t));
  else d = new Date(t);
  if (isNaN(d.getTime())) throw new Error("не понял дату: введите число секунд, миллисекунд или дату");
  return [
    `Unix (сек): ${Math.floor(d.getTime() / 1000)}`,
    `Unix (мс): ${d.getTime()}`,
    `ISO: ${d.toISOString()}`,
    `Местное: ${d.toLocaleString()}`,
    `UTC: ${d.toUTCString()}`,
  ].join("\n");
}

export function cases(s: string): string {
  const words = s
    .replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, "$1 $2")
    .split(/[^A-Za-zА-Яа-яЁё0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  return [
    `camelCase: ${words.map((w, i) => (i ? cap(w) : w)).join("")}`,
    `PascalCase: ${words.map(cap).join("")}`,
    `snake_case: ${words.join("_")}`,
    `SCREAMING_SNAKE: ${words.join("_").toUpperCase()}`,
    `kebab-case: ${words.join("-")}`,
    `Title Case: ${words.map(cap).join(" ")}`,
  ].join("\n");
}

export function colorInfo(input: string): string {
  const s = input.trim();
  let r: number, g: number, b: number;
  let m: RegExpExecArray | null;
  if ((m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s))) {
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s))) {
    [r, g, b] = [m[1], m[2], m[3]].map(Number);
  } else throw new Error("введите цвет как #ff8800 или rgb(255, 136, 0)");
  const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h *= 60;
  }
  const lum = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lum(rn) + 0.7152 * lum(gn) + 0.0722 * lum(bn);
  const contrast = (a: number, b2: number) => ((Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05)).toFixed(2);
  return [
    `HEX: ${hex}`,
    `RGB: rgb(${r}, ${g}, ${b})`,
    `HSL: hsl(${Math.round(h)}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`,
    `Контраст с белым: ${contrast(L, 1)} · с чёрным: ${contrast(L, 0)}`,
    `Текст поверх лучше: ${L > 0.179 ? "чёрный" : "белый"}`,
  ].join("\n");
}

export const TOOLS: { id: string; label: string; placeholder: string; run: (s: string) => string | Promise<string> }[] = [
  { id: "ts", label: "JSON → TypeScript", placeholder: '{"id": 1, "name": "Artur", "tags": ["a"]}', run: (s) => jsonToTs(s) },
  { id: "json", label: "Красивый JSON", placeholder: '{"a":1,"b":[1,2]}', run: (s) => JSON.stringify(JSON.parse(s), null, 2) },
  { id: "jsonmin", label: "Сжать JSON", placeholder: '{\n  "a": 1\n}', run: (s) => JSON.stringify(JSON.parse(s)) },
  { id: "b64e", label: "Base64: закодировать", placeholder: "Привет", run: b64encode },
  { id: "b64d", label: "Base64: раскодировать", placeholder: "0J/RgNC40LLQtdGC", run: b64decode },
  { id: "urle", label: "URL: закодировать", placeholder: "привет мир&x=1", run: (s) => encodeURIComponent(s) },
  { id: "urld", label: "URL: раскодировать", placeholder: "%D0%BF%D1%80%D0%B8", run: (s) => decodeURIComponent(s) },
  { id: "jwt", label: "Разобрать JWT", placeholder: "eyJhbGciOi…", run: decodeJwt },
  { id: "hash", label: "Хэши SHA", placeholder: "любой текст", run: hashes },
  { id: "uuid", label: "UUID", placeholder: "(ничего вводить не нужно)", run: () => uuids() },
  { id: "time", label: "Время и Unix", placeholder: "1731628800 или 2026-11-15 (пусто — сейчас)", run: timeInfo },
  { id: "case", label: "camelCase / snake_case", placeholder: "user profile name", run: cases },
  { id: "color", label: "Цвет и контраст", placeholder: "#3b82f6", run: colorInfo },
  { id: "count", label: "Подсчёт текста", placeholder: "любой текст", run: (s) => `Символов: ${s.length}\nБез пробелов: ${s.replace(/\s/g, "").length}\nСлов: ${(s.match(/\S+/g) ?? []).length}\nСтрок: ${s ? s.split("\n").length : 0}\nБайт (UTF-8): ${new TextEncoder().encode(s).length}` },
];
