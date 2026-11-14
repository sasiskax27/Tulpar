// Логика HTTP-клиента: разбор заголовков, переменные {{name}}, curl ⇄ запрос.
export interface HttpDraft {
  method: string;
  url: string;
  headers: string; // «Имя: значение» построчно
  body: string;
}

export interface HttpHistoryItem extends HttpDraft {
  time: number;
  status?: number;
  name?: string;
}

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function parseHeaders(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i <= 0) continue;
    out.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]);
  }
  return out;
}

/** Переменные окружения: строки «name = value». */
export function parseVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([\w.-]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) vars[m[1]] = m[2];
  }
  return vars;
}

export function applyVars(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, name: string) => (name in vars ? vars[name] : all));
}

/** Разбить командную строку с учётом кавычек и переносов «\». */
function shellSplit(cmd: string): string[] {
  const s = cmd.replace(/\\\r?\n/g, " ");
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
    } else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** Вставили «curl …» — превращаем в запрос. */
export function fromCurl(cmd: string): HttpDraft | null {
  const args = shellSplit(cmd.trim());
  if (args[0] !== "curl") return null;
  let method = "";
  let url = "";
  const headers: string[] = [];
  let body = "";
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "-X" || a === "--request") method = (args[++i] ?? "").toUpperCase();
    else if (a === "-H" || a === "--header") headers.push(args[++i] ?? "");
    else if (["-d", "--data", "--data-raw", "--data-binary", "--json"].includes(a)) {
      body = args[++i] ?? "";
      if (a === "--json") headers.push("Content-Type: application/json");
    } else if (a === "-u" || a === "--user") headers.push("Authorization: Basic " + btoa(args[++i] ?? ""));
    else if (a === "--url") url = args[++i] ?? "";
    else if (!a.startsWith("-") && !url) url = a;
  }
  if (!url) return null;
  return { method: method || (body ? "POST" : "GET"), url, headers: headers.join("\n"), body };
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export function toCurl(d: HttpDraft): string {
  const parts = ["curl", "-X", d.method, q(d.url)];
  for (const [k, v] of parseHeaders(d.headers)) parts.push("-H", q(`${k}: ${v}`));
  if (d.body && d.method !== "GET" && d.method !== "HEAD") parts.push("--data-raw", q(d.body));
  return parts.join(" ");
}

export function toFetch(d: HttpDraft): string {
  const opts: string[] = [`  method: ${JSON.stringify(d.method)},`];
  const h = parseHeaders(d.headers);
  if (h.length) opts.push(`  headers: {\n${h.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}\n  },`);
  if (d.body && d.method !== "GET" && d.method !== "HEAD") opts.push(`  body: ${JSON.stringify(d.body)},`);
  return `const res = await fetch(${JSON.stringify(d.url)}, {\n${opts.join("\n")}\n});\nconst data = await res.json();`;
}

export function toPython(d: HttpDraft): string {
  const h = parseHeaders(d.headers);
  const lines = ["import requests", "", `res = requests.request(${JSON.stringify(d.method)}, ${JSON.stringify(d.url)},`];
  if (h.length) lines.push(`    headers={${h.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")}},`);
  if (d.body && d.method !== "GET") lines.push(`    data=${JSON.stringify(d.body)},`);
  lines.push(")", "print(res.status_code, res.text)");
  return lines.join("\n");
}

export function prettyBody(body: string, headers: [string, string][]): { text: string; json: boolean } {
  const type = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  const t = body.trim();
  if (type.includes("json") || /^[[{]/.test(t)) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), json: true };
    } catch {
      /* не JSON */
    }
  }
  return { text: body, json: false };
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
