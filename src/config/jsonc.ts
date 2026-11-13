// Разбор JSON с комментариями и висячими запятыми (JSONC) — как в настройках VS Code.

export function parseJsonc<T>(text: string): T {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += ch;
    }
  }
  // Висячие запятые перед } или ] (вне строк — строки уже не содержат комментариев)
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out) as T;
}
