// Разбор CSV/TSV с кавычками и переносами внутри полей.
export function detectDelimiter(text: string, path: string): string {
  if (/\.tsv$/i.test(path)) return "\t";
  const head = text.slice(0, 5000).split("\n").slice(0, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, head.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text: string, delim: string, limit = 100_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === delim) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      if (rows.length >= limit) return rows;
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

export const isNumeric = (v: string) => /^-?\d+([.,]\d+)?$/.test(v.trim().replace(/\s/g, ""));
export const toNumber = (v: string) => Number(v.trim().replace(/\s/g, "").replace(",", "."));

export function columnStats(rows: string[][], col: number): string {
  const vals = rows.map((r) => r[col] ?? "").filter((v) => v.trim() !== "");
  const nums = vals.filter(isNumeric).map(toNumber);
  const uniq = new Set(vals).size;
  if (nums.length && nums.length >= vals.length * 0.8) {
    const sum = nums.reduce((a, b) => a + b, 0);
    const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(Math.round(n * 100) / 100));
    return `Σ ${fmt(sum)} · среднее ${fmt(sum / nums.length)} · мин ${fmt(Math.min(...nums))} · макс ${fmt(Math.max(...nums))}`;
  }
  return `заполнено ${vals.length} · разных ${uniq}`;
}

export function toCsv(rows: string[][], delim: string): string {
  return rows
    .map((r) => r.map((v) => (v.includes(delim) || /["\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(delim))
    .join("\n");
}
