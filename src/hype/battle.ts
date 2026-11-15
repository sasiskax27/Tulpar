// ⚔️ Битва с ИИ: одна задача, вы и ИИ решаете на скорость, тесты — настоящие.
import { askAi, pickJson } from "../tools/ai";
import { runPython } from "../learn/learn";
import type { Lesson } from "../learn/courses";

export type BattleLang = "python" | "javascript";
export type Level = "easy" | "medium" | "hard";

export interface BattleTask {
  title: string;
  description: string;
  /** имя функции */
  fn: string;
  starter: string;
  /** аргументы и ожидаемый ответ — литералы языка (Python) или JSON (JS) */
  tests: { args: string; expected: string }[];
}

export interface TestResult {
  passed: number;
  total: number;
  details: string[];
  error?: string;
}

export async function makeTask(lang: BattleLang, level: Level, topic: string): Promise<BattleTask | null> {
  const answer = await askAi(
    `You create short programming challenges for a speed battle. Language: ${lang}. Difficulty: ${level} (easy = 2-5 lines, medium = loops/strings/dicts, hard = small algorithm). ` +
      `Reply ONLY with JSON: {"title":"...","description":"task text for a student, 1-3 sentences, with one example","fn":"function_name","starter":"function stub with empty body","tests":[{"args":"...","expected":"..."}]}. ` +
      (lang === "python"
        ? `args is a Python tuple literal of arguments like "(3, [1, 2])" and expected is a Python literal like "5" or "'abc'".`
        : `args is a JSON array of arguments like "[3, [1, 2]]" and expected is JSON like "5" or "\\"abc\\"".`) +
      ` Give 5 tests including edge cases. Write title and description in the user's language.`,
    topic ? `Topic: ${topic}` : "Any interesting topic.",
  );
  const task = answer ? pickJson<BattleTask>(answer) : null;
  if (!task?.fn || !Array.isArray(task.tests) || !task.tests.length) return null;
  return task;
}

export async function aiSolve(task: BattleTask, lang: BattleLang): Promise<string> {
  const answer = await askAi(
    `Solve the challenge. Reply ONLY with the complete ${lang} code of function ${task.fn} in one fenced code block, no explanations.`,
    `${task.title}\n${task.description}\n\nStarter:\n${task.starter}`,
  );
  const m = answer ? /```[^\n]*\n([\s\S]*?)```/.exec(answer) : null;
  return (m ? m[1] : answer ?? "").trim();
}

export async function runTests(code: string, task: BattleTask, lang: BattleLang): Promise<TestResult> {
  return lang === "python" ? runPy(code, task) : runJs(code, task);
}

async function runPy(code: string, task: BattleTask): Promise<TestResult> {
  const cases = task.tests.map((t) => `(${t.args}, ${t.expected})`).join(",\n  ");
  const harness = `${code}\n\n__cases = [\n  ${cases}\n]\nfor __i, (__a, __e) in enumerate(__cases):\n    try:\n        __a = __a if isinstance(__a, tuple) else (__a,)\n        __g = ${task.fn}(*__a)\n        print("TEST", __i, "OK" if __g == __e else "FAIL", repr(__g))\n    except Exception as __x:\n        print("TEST", __i, "ERR", repr(__x))\n`;
  const r = await runPython(harness, { id: "battle", title: "", text: "", starter: "" } as Lesson, false);
  return parse(r.output, task, r.error);
}

function runJs(code: string, task: BattleTask): Promise<TestResult> {
  const src = `onmessage = (e) => {
    const out = [];
    try {
      const fn = new Function(e.data.code + "\\n;return typeof ${task.fn} === 'function' ? ${task.fn} : undefined;")();
      if (!fn) { postMessage({ error: "Функция ${task.fn} не найдена" }); return; }
      e.data.tests.forEach((t, i) => {
        try {
          const got = fn(...JSON.parse(t.args));
          const ok = JSON.stringify(got) === JSON.stringify(JSON.parse(t.expected));
          out.push("TEST " + i + (ok ? " OK " : " FAIL ") + JSON.stringify(got));
        } catch (x) { out.push("TEST " + i + " ERR " + x); }
      });
      postMessage({ output: out.join("\\n") });
    } catch (x) { postMessage({ error: String(x) }); }
  };`;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const w = new Worker(url);
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ passed: 0, total: task.tests.length, details: [], error: "Код работал дольше 5 секунд — возможно, бесконечный цикл" });
    }, 5000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      URL.revokeObjectURL(url);
      resolve(parse(e.data.output ?? "", task, e.data.error));
    };
    w.postMessage({ code, tests: task.tests });
  });
}

function parse(output: string, task: BattleTask, error?: string): TestResult {
  const details: string[] = [];
  let passed = 0;
  for (const line of output.split("\n")) {
    const m = /^TEST (\d+) (OK|FAIL|ERR) ?(.*)$/.exec(line.trim());
    if (!m) continue;
    const t = task.tests[Number(m[1])];
    if (m[2] === "OK") passed++;
    details.push(m[2] === "OK" ? `✓ ${task.fn}${t.args}` : `✗ ${task.fn}${t.args} → ${m[3]} (ожидалось ${t.expected})`);
  }
  return { passed, total: task.tests.length, details, error: passed ? undefined : error?.split("\n").slice(-3).join("\n") };
}

// ---- Счёт ----
const KEY = "tulpar.battle.score";
export function loadScore(): { you: number; ai: number } {
  try {
    return { you: 0, ai: 0, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { you: 0, ai: 0 };
  }
}
export function saveScore(s: { you: number; ai: number }) {
  localStorage.setItem(KEY, JSON.stringify(s));
}
