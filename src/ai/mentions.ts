// @-упоминания в чате ИИ: «@main.py @терминал почему падает?» — к вопросу
// прикладывается содержимое файла, вывод терминала, ошибки или git diff.
import { core, baseName } from "../ipc";
import { root } from "../app/workspace";
import { problems, relOf } from "../problems/problems";
import { terminalText } from "../terminal/sessions";
import { modelFor } from "../editor/tabs";
import { editorInstance } from "../editor/instance";

export interface MentionItem {
  /** Что вставляется после @ */
  insert: string;
  label: string;
  hint: string;
  kind: "special" | "file";
}

export const SPECIAL: MentionItem[] = [
  { insert: "терминал", label: "@терминал", hint: "последний вывод терминала", kind: "special" },
  { insert: "ошибки", label: "@ошибки", hint: "ошибки и предупреждения из «Проблем»", kind: "special" },
  { insert: "git", label: "@git", hint: "незакоммиченные изменения (diff)", kind: "special" },
  { insert: "выделение", label: "@выделение", hint: "выделенный код в редакторе", kind: "special" },
];

const ALIASES: Record<string, string> = {
  терминал: "terminal", terminal: "terminal", term: "terminal",
  ошибки: "errors", errors: "errors", problems: "errors", проблемы: "errors",
  git: "git", diff: "git", изменения: "git",
  выделение: "selection", selection: "selection",
};

const MAX_FILE = 30_000;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "\n…(обрезано)" : s);

let filesCache: { root: string; files: string[]; at: number } | null = null;

/** Файлы проекта (относительные пути) — для подсказок и поиска упоминаний. */
export async function projectFiles(): Promise<string[]> {
  const r = root();
  if (!r) return [];
  if (filesCache && filesCache.root === r && Date.now() - filesCache.at < 30_000) return filesCache.files;
  const files = await core.listFiles().catch(() => [] as string[]);
  filesCache = { root: r, files, at: Date.now() };
  return files;
}

/** Подсказки для текста после @. */
export async function suggest(query: string): Promise<MentionItem[]> {
  const q = query.toLowerCase();
  const special = SPECIAL.filter((s) => !q || s.insert.startsWith(q) || Object.entries(ALIASES).some(([k, v]) => k.startsWith(q) && ALIASES[s.insert] === v));
  const files = await projectFiles();
  const scored = files
    .map((f) => {
      const lower = f.toLowerCase().replace(/\\/g, "/");
      const name = lower.split("/").pop() ?? lower;
      const score = !q ? 1 : name.startsWith(q) ? 3 : name.includes(q) ? 2 : lower.includes(q) ? 1 : 0;
      return { f: f.replace(/\\/g, "/"), score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.length - b.f.length)
    .slice(0, 12);
  return [
    ...special,
    ...scored.map(({ f }) => ({ insert: f, label: baseName(f), hint: f, kind: "file" as const })),
  ].slice(0, 14);
}

const sep = () => (root()?.includes("\\") ? "\\" : "/");

/** Найти упоминания в тексте и собрать для них контекст. */
export async function resolveMentions(text: string): Promise<{ blocks: string[]; labels: string[] }> {
  const blocks: string[] = [];
  const labels: string[] = [];
  const seen = new Set<string>();
  const files = await projectFiles();
  const normFiles = new Map(files.map((f) => [f.replace(/\\/g, "/").toLowerCase(), f]));

  for (const m of text.matchAll(/(^|\s)@([^\s,;!?()"'`]+)/g)) {
    const token = m[2].replace(/[.:]+$/, "");
    if (seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    const special = ALIASES[token.toLowerCase()];
    if (special === "terminal") {
      const out = terminalText(150);
      blocks.push(out ? `Вывод терминала (последние строки):\n\`\`\`\n${cut(out, 15_000)}\n\`\`\`` : "Терминал пуст.");
      labels.push("@терминал");
    } else if (special === "errors") {
      const list = problems().slice(0, 80);
      blocks.push(
        list.length
          ? "Проблемы в проекте:\n" +
              list.map((p) => `- ${relOf(p.path)}:${p.line}:${p.column} [${p.severity}] ${p.message}${p.source ? ` (${p.source})` : ""}`).join("\n")
          : "Проблем не найдено.",
      );
      labels.push(`@ошибки: ${list.length}`);
    } else if (special === "git") {
      const diff = await core.gitDiffForMessage().catch(() => "");
      blocks.push(diff.trim() ? `Незакоммиченные изменения (git diff):\n\`\`\`diff\n${cut(diff, 25_000)}\n\`\`\`` : "Изменений в git нет.");
      labels.push("@git");
    } else if (special === "selection") {
      const ed = editorInstance();
      const model = ed?.getModel();
      const sel = ed?.getSelection();
      if (model && sel && !sel.isEmpty()) {
        blocks.push(`Выделенный код (строки ${sel.startLineNumber}–${sel.endLineNumber}):\n\`\`\`\n${cut(model.getValueInRange(sel), MAX_FILE)}\n\`\`\``);
        labels.push("@выделение");
      }
    } else if (root()) {
      // Файл: точный относительный путь или уникальное имя файла
      const key = token.replace(/\\/g, "/").toLowerCase();
      let rel = normFiles.get(key);
      if (!rel) {
        const byName = files.filter((f) => f.replace(/\\/g, "/").toLowerCase().endsWith("/" + key) || f.toLowerCase() === key);
        if (byName.length === 1) rel = byName[0];
      }
      if (!rel) continue;
      const abs = root()! + sep() + rel.replace(/[\\/]/g, sep());
      const text = modelFor(abs)?.getValue() ?? (await core.readFile(abs).catch(() => null));
      if (text === null) continue;
      blocks.push(`Файл ${rel.replace(/\\/g, "/")}:\n\`\`\`\n${cut(text, MAX_FILE)}\n\`\`\``);
      labels.push("@" + baseName(rel));
    }
  }
  return { blocks, labels };
}
