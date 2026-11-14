// Ошибки из вывода терминала: упавшая программа и неудачная сборка.
// Понимает Python (Traceback), Rust/Cargo, C/C++ (gcc, clang), Go, Java
// (javac, Maven), Kotlin (Gradle), TypeScript (tsc), C# (dotnet), Node.js
// и общий вид «файл:строка:столбец: error: текст».

export interface ParsedError {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  source: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

const FILE = String.raw`(\/?(?:[A-Za-z]:)?[^\s:()"'<>|*?\[\]]+\.[A-Za-z0-9]+)`;

const PATTERNS: { re: RegExp; source: string; map: (m: RegExpMatchArray) => Omit<ParsedError, "source"> | null }[] = [
  // Maven: [ERROR] /path/App.java:[12,5] cannot find symbol
  {
    re: new RegExp(String.raw`^\[(ERROR|WARNING)\]\s+${FILE}:\[(\d+),(\d+)\]\s*(.*)$`),
    source: "Maven",
    map: (m) => ({ severity: m[1] === "ERROR" ? "error" : "warning", file: m[2], line: +m[3], column: +m[4], message: m[5] }),
  },
  // Kotlin / Gradle: e: file:///C:/p/Main.kt:12:5 Unresolved reference
  {
    re: new RegExp(String.raw`^([ew]):\s+(?:file:\/\/\/?)?${FILE}:(\d+):(\d+)\s+(.*)$`),
    source: "Kotlin",
    map: (m) => ({ severity: m[1] === "e" ? "error" : "warning", file: m[2], line: +m[3], column: +m[4], message: m[5] }),
  },
  // tsc / dotnet / MSVC: src/a.ts(12,5): error TS2345: text
  {
    re: new RegExp(String.raw`^${FILE}\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z]+\d+)?:?\s*(.*)$`),
    source: "Сборка",
    map: (m) => ({ file: m[1], line: +m[2], column: +m[3], severity: m[4] as "error" | "warning", message: (m[5] ? m[5] + ": " : "") + m[6] }),
  },
  // gcc / clang / javac / общий: file:12:5: error: text   или   File.java:5: error: text
  {
    re: new RegExp(String.raw`^${FILE}:(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.*)$`, "i"),
    source: "Компилятор",
    map: (m) => ({ file: m[1], line: +m[2], column: +(m[3] ?? 1), severity: /warn/i.test(m[4]) ? "warning" : "error", message: m[5] }),
  },
];

/** Go и линтеры пишут «file.go:12:5: текст» без слова error. */
const GO_LIKE = new RegExp(String.raw`^(?:\.\/)?${FILE}:(\d+):(\d+):\s+(.+)$`);

/**
 * Разобрать вывод (уже без ANSI) на ошибки. Многострочные форматы
 * (Python Traceback, Rust) собираются по соседним строкам.
 */
export function parseErrors(lines: string[]): ParsedError[] {
  const out: ParsedError[] = [];
  let pyFrame: { file: string; line: number } | null = null;
  let inTraceback = false;
  let rust: { severity: "error" | "warning"; message: string } | null = null;
  let jsMessage: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\r/g, "").trimEnd();
    const t = line.trim();
    if (!t) continue;

    // ---- Python ----
    if (t.startsWith("Traceback (most recent call last)")) {
      inTraceback = true;
      pyFrame = null;
      continue;
    }
    const frame = t.match(/^File "(.+?)", line (\d+)/);
    if (frame) {
      // Кадры внутри библиотек пропускаем — нужна строка из своего кода
      if (!/[\\/](site-packages|lib[\\/]python\d|Lib)[\\/]/.test(frame[1]) && !frame[1].startsWith("<")) {
        pyFrame = { file: frame[1], line: +frame[2] };
      }
      continue;
    }
    if (inTraceback && pyFrame && /^[A-Za-z_][\w.]*(Error|Exception|Warning|Interrupt|Exit)\b/.test(t)) {
      out.push({ file: pyFrame.file, line: pyFrame.line, column: 1, severity: "error", message: t, source: "Python" });
      inTraceback = false;
      pyFrame = null;
      continue;
    }
    // SyntaxError без Traceback: File "x.py", line 3 ... SyntaxError: ...
    if (!inTraceback && pyFrame && /^(SyntaxError|IndentationError|TabError)\b/.test(t)) {
      out.push({ file: pyFrame.file, line: pyFrame.line, column: 1, severity: "error", message: t, source: "Python" });
      pyFrame = null;
      continue;
    }

    // ---- Rust ----
    const rhead = t.match(/^(error|warning)(\[[A-Z]\d+\])?:\s+(.+)$/);
    if (rhead && !/^(error|warning): (could not compile|aborting|build failed|\d+ warnings? emitted)/.test(t)) {
      rust = { severity: rhead[1] as "error" | "warning", message: (rhead[2] ? rhead[2].slice(1, -1) + ": " : "") + rhead[3] };
      continue;
    }
    const arrow = t.match(new RegExp(String.raw`^-->\s+${FILE}:(\d+):(\d+)`));
    if (arrow && rust) {
      out.push({ file: arrow[1], line: +arrow[2], column: +arrow[3], severity: rust.severity, message: rust.message, source: "Rust" });
      rust = null;
      continue;
    }

    // ---- Node.js: TypeError: x  →  at fn (C:\p\a.js:12:5) ----
    if (/^[A-Z]\w*(Error|Exception): /.test(t)) {
      jsMessage = t;
    } else if (jsMessage) {
      const at = t.match(new RegExp(String.raw`^at (?:.+? \()?(?:file:\/\/\/?)?${FILE}:(\d+):(\d+)\)?$`));
      if (at && !/node_modules|node:internal/.test(at[1])) {
        out.push({ file: at[1], line: +at[2], column: +at[3], severity: "error", message: jsMessage, source: "Node.js" });
        jsMessage = null;
        continue;
      }
    }

    // ---- однострочные форматы ----
    let matched = false;
    for (const p of PATTERNS) {
      const m = t.match(p.re);
      if (!m) continue;
      const e = p.map(m);
      if (e && e.message) {
        out.push({ ...e, source: p.source });
        matched = true;
      }
      break;
    }
    if (matched) continue;
    const go = t.match(GO_LIKE);
    if (go && /\.(go|py|rb|php|lua|sh|zig|nim|swift|dart)$/.test(go[1])) {
      out.push({ file: go[1], line: +go[2], column: +go[3], severity: "error", message: go[4], source: "Компилятор" });
    }
  }
  // «/C:/p/a.java» (Maven, file:///) → «C:/p/a.java»
  for (const e of out) e.file = e.file.replace(/^\/([A-Za-z]:)/, "$1");
  // Одинаковые ошибки (компиляторы любят повторять) — один раз
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.file}:${e.line}:${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
