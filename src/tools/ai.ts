// Короткий запрос к ИИ для встроенных инструментов.
import { core } from "../ipc";
import { aiBase } from "../ai/ai";
import { settings } from "../config/store";
import { aiLanguage } from "../i18n/translate";

export async function askAi(system: string, prompt: string): Promise<string | null> {
  const base = aiBase();
  if (!base) return null;
  const lang = aiLanguage(settings()["tulpar.ai.language"]);
  return core.aiComplete({ ...base, system: `${system} Answer in this language: ${lang}.`, prompt });
}

/** Первый JSON-объект из ответа модели. */
export function pickJson<T>(answer: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer);
  const text = fenced ? fenced[1] : answer;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export function copy(text: string) {
  void navigator.clipboard.writeText(text);
}
