// Системные диалоги рисует ОС, а не наше окно, — переводим их текст заранее.
import { ask as rawAsk, open as rawOpen } from "@tauri-apps/plugin-dialog";
import { t } from "./translate";

type AskOptions = { title?: string; kind?: "info" | "warning" | "error"; okLabel?: string; cancelLabel?: string };
type OpenOptions = {
  title?: string;
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
};

export function ask(message: string, options?: string | AskOptions): Promise<boolean> {
  if (typeof options === "string") return rawAsk(t(message), t(options));
  const o: AskOptions = { ...options };
  if (o.title) o.title = t(o.title);
  if (o.okLabel) o.okLabel = t(o.okLabel);
  if (o.cancelLabel) o.cancelLabel = t(o.cancelLabel);
  return rawAsk(t(message), o);
}

export function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  return rawOpen({
    ...options,
    title: options.title && t(options.title),
    filters: options.filters?.map((f) => ({ ...f, name: t(f.name) })),
  });
}
