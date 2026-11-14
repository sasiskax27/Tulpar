// Поиск по проекту: запрос, флаги, результаты и замена.
// Ищет ядро на Rust; открытые файлы при замене меняются прямо в редакторе,
// чтобы правку можно было отменить через Ctrl+Z.
import { createSignal } from "solid-js";
import { ask } from "@tauri-apps/plugin-dialog";
import { core, type SearchOptions, type SearchResult } from "../ipc";
import { monaco } from "../editor/monaco";
import { modelFor } from "../editor/tabs";
import { root } from "../app/workspace";
import { notify, notifyError } from "../app/notify";

const [query, setQuery] = createSignal("");
const [replacement, setReplacement] = createSignal("");
const [caseSensitive, setCaseSensitive] = createSignal(false);
const [wholeWord, setWholeWord] = createSignal(false);
const [useRegex, setUseRegex] = createSignal(false);
const [include, setInclude] = createSignal("");
const [exclude, setExclude] = createSignal("");
const [result, setResult] = createSignal<SearchResult | null>(null);
const [error, setError] = createSignal<string | null>(null);
const [busy, setBusy] = createSignal(false);

export {
  query, setQuery, replacement, setReplacement, caseSensitive, setCaseSensitive,
  wholeWord, setWholeWord, useRegex, setUseRegex, include, setInclude, exclude, setExclude,
  result, error, busy,
};

const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/? \t";

function options(): SearchOptions {
  return {
    query: query(),
    caseSensitive: caseSensitive(),
    wholeWord: wholeWord(),
    regex: useRegex(),
    include: include(),
    exclude: exclude(),
  };
}

let generation = 0;
let timer: number | undefined;

/** Запустить поиск. Старые запросы, которые ещё не вернулись, игнорируются. */
export async function runSearch() {
  clearTimeout(timer);
  const mine = ++generation;
  if (!query() || !root()) {
    setResult(null);
    setError(null);
    setBusy(false);
    return;
  }
  setBusy(true);
  try {
    const res = await core.searchProject(options());
    if (mine !== generation) return;
    setResult(res);
    setError(null);
  } catch (e) {
    if (mine !== generation) return;
    setResult(null);
    setError(String(e));
  } finally {
    if (mine === generation) setBusy(false);
  }
}

/** Поиск по мере набора — с паузой, чтобы не искать на каждую букву. */
export function searchSoon() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void runSearch(), 250);
}

/** Заменить в открытом файле через редактор — с отменой одной операцией. */
function replaceInModel(model: monaco.editor.ITextModel): number {
  const matches = model.findMatches(
    query(),
    false,
    useRegex(),
    caseSensitive(),
    wholeWord() ? WORD_SEPARATORS : null,
    useRegex(),
  );
  if (!matches.length) return 0;
  const jsRegex = useRegex() ? new RegExp(query(), caseSensitive() ? "" : "i") : null;
  const edits = matches.map((m) => ({
    range: m.range,
    text: jsRegex && m.matches ? m.matches[0].replace(jsRegex, replacement()) : replacement(),
  }));
  model.pushStackElement();
  model.pushEditOperations([], edits, () => null);
  model.pushStackElement();
  return matches.length;
}

export async function replaceAll() {
  const res = result();
  if (!res || res.total === 0) return;
  const files = res.files.length;
  const ok = await ask(
    `Заменить ${res.total} ${plural(res.total, "совпадение", "совпадения", "совпадений")} ` +
      `в ${files} ${plural(files, "файле", "файлах", "файлах")} на «${replacement()}»?` +
      "\n\nОткрытые файлы изменятся в редакторе (их можно отменить через Ctrl+Z), остальные — сразу на диске.",
    { title: "Tulpar", kind: "warning", okLabel: "Заменить", cancelLabel: "Отмена" },
  );
  if (!ok) return;
  let count = 0;
  let failed = 0;
  for (const file of res.files) {
    const model = modelFor(file.path) ?? monaco.editor.getModel(monaco.Uri.file(file.path));
    try {
      count += model ? replaceInModel(model) : await core.replaceInFile(file.path, options(), replacement());
    } catch (e) {
      failed++;
      notifyError(`Не удалось заменить в ${file.rel}`, e);
    }
  }
  notify(`Заменено: ${count}${failed ? `, ошибок: ${failed}` : ""}`);
  await runSearch();
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
