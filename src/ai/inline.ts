// Подсказки ИИ при наборе: серый текст продолжения, Tab — принять, Esc — скрыть.
// Включаются в настройках («ИИ → Подсказки при наборе»).
//
// С Ollama используется режим «заполнить середину»: модель видит код до курсора
// и после него — так маленькая быстрая модель (например, qwen2.5-coder 1.5B)
// даёт точные подсказки за доли секунды. С другими серверами — обычный чат.
import { monaco } from "../editor/monaco";
import { core } from "../ipc";
import { settings } from "../config/store";
import { providers } from "./ai";

const DELAY_MS = 350;
const PREFIX_CHARS = 4000;
const SUFFIX_CHARS = 1500;
const MAX_LINES = 12;

let last: { key: string; text: string } | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function config() {
  const s = settings();
  if (!s["tulpar.ai.inline"] || s["tulpar.ai.inlineProvider"] === "copilot") return null;
  const provider = s["tulpar.ai.provider"];
  const defaults = providers[provider];
  if (!defaults) return null;
  const model = s["tulpar.ai.inlineModel"].trim() || s["tulpar.ai.model"].trim() || defaults.model;
  if (!model) return null;
  return { provider, model, baseUrl: s["tulpar.ai.baseUrl"].trim() || defaults.baseUrl, apiKey: s["tulpar.ai.apiKey"] };
}

/** Обрезать подсказку: не больше MAX_LINES строк и без повтора текста после курсора. */
function tidy(text: string, suffix: string): string {
  let t = text.replace(/\r/g, "");
  const fenced = t.match(/```[^\n]*\n([\s\S]*?)(\n```|$)/);
  if (fenced) t = fenced[1];
  const lines = t.split("\n").slice(0, MAX_LINES);
  t = lines.join("\n").replace(/\s+$/, "");
  // Модель иногда повторяет начало того, что уже стоит после курсора
  const nextLine = suffix.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (nextLine && t.endsWith(nextLine)) t = t.slice(0, t.length - nextLine.length).replace(/\s+$/, "");
  return t;
}

async function complete(prefix: string, suffix: string, language: string): Promise<string> {
  const cfg = config();
  if (!cfg) return "";
  if (cfg.provider === "ollama") {
    return core.aiFill({ host: cfg.baseUrl, model: cfg.model, prefix, suffix, maxTokens: 96 });
  }
  return core.aiComplete({
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    apiKey: cfg.apiKey,
    system:
      "You are a code completion engine. Continue the code exactly at <CURSOR>. " +
      "Reply with ONLY the text to insert at the cursor: no explanations, no markdown, " +
      "do not repeat code that is already before or after the cursor. Keep it short: at most a few lines.",
    prompt: `Language: ${language}\n\n${prefix}<CURSOR>${suffix}`,
  });
}

export function registerInlineCompletions() {
  monaco.languages.registerInlineCompletionsProvider("*", {
    async provideInlineCompletions(model, position, _context, token) {
      if (!config() || model.uri.scheme !== "file") return { items: [] };
      const offset = model.getOffsetAt(position);
      const full = model.getValue();
      const prefix = full.slice(Math.max(0, offset - PREFIX_CHARS), offset);
      const suffix = full.slice(offset, offset + SUFFIX_CHARS);
      // Не подсказываем посреди слова справа: там обычно мешает
      const after = model.getLineContent(position.lineNumber).slice(position.column - 1);
      if (/^\w/.test(after)) return { items: [] };

      const key = `${model.uri.toString()}:${offset}:${prefix.slice(-200)}`;
      let text: string;
      if (last?.key === key) {
        text = last.text;
      } else {
        // Ждём паузу в наборе: каждое новое нажатие отменяет этот запрос
        await sleep(DELAY_MS);
        if (token.isCancellationRequested) return { items: [] };
        try {
          text = tidy(await complete(prefix, suffix, model.getLanguageId()), suffix);
        } catch {
          return { items: [] };
        }
        if (token.isCancellationRequested) return { items: [] };
        last = { key, text };
      }
      if (!text.trim()) return { items: [] };
      return {
        items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }],
      };
    },
    freeInlineCompletions() {},
  });
}
