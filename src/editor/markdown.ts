// Простой и безопасный перевод Markdown в HTML для предпросмотра README и заметок.
// Весь текст экранируется; поддерживаются заголовки, списки, цитаты, код,
// таблицы, ссылки, картинки, жирный, курсив и зачёркнутый текст.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function safeUrl(url: string): string {
  const u = url.trim();
  return /^(https?:|mailto:|#|\.{0,2}\/|[\w-]+\.)/i.test(u) && !/^javascript:/i.test(u) ? u : "#";
}

/** Строчная разметка: `код`, **жирный**, *курсив*, ~~зачёркнутый~~, [ссылка](url), ![картинка](url). */
function inline(text: string, resolveImage: (src: string) => string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => `<img alt="${alt}" src="${esc(resolveImage(src))}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${esc(safeUrl(href))}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, pre, url) => `${pre}<a href="${url}">${url}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

export function markdownToHtml(md: string, resolveImage: (src: string) => string = (s) => s): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "), resolveImage)}</p>`);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code class="lang-${esc(fence[2])}">${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2], resolveImage)}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(quote.join("\n"), resolveImage)}</blockquote>`);
      continue;
    }
    // Таблица: строка с | и строка-разделитель ---
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c, resolveImage)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, resolveImage)}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
        items.push(
          task
            ? `<li class="task"><input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ${inline(task[2], resolveImage)}</li>`
            : `<li>${inline(m[3], resolveImage)}</li>`,
        );
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}
