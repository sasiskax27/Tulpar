// Перевод интерфейса. Tulpar написан по-русски, а для английского языка
// надписи подменяются на лету по словарю: и в окне (через MutationObserver),
// и там, куда DOM не дотягивается (системные диалоги, меню Monaco) — через t().
import { EXACT, PATTERNS } from "./en";

export type Lang = "ru" | "en";
const KEY = "tulpar.lang";

function detect(): Lang {
  const nav = (navigator.language || "").toLowerCase();
  return /^(ru|kk|uk|be|ky|uz|tt)/.test(nav) ? "ru" : "en";
}

/** Значение настройки workbench.language → итоговый язык. */
export function resolveLang(setting: unknown): Lang {
  return setting === "ru" || setting === "en" ? setting : detect();
}

let lang: Lang = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ru" || saved === "en") return saved;
  } catch {
    /* хранилище недоступно */
  }
  return detect();
})();

export function currentLang(): Lang {
  return lang;
}

/** Запомнить язык. true — язык сменился и окно нужно перезагрузить. */
export function setLang(next: Lang): boolean {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ничего */
  }
  if (next === lang) return false;
  lang = next;
  return true;
}

const CYR = /[А-Яа-яЁё]/;

type Pattern = { re: RegExp; order: number[]; out: string };
const patterns: Pattern[] = Object.entries(PATTERNS)
  .map(([ru, out]) => {
    const order: number[] = [];
    const src = ru
      .split(/(\{\d\})/)
      .map((part) => {
        const m = /^\{(\d)\}$/.exec(part);
        if (m) {
          order.push(Number(m[1]));
          return "([\\s\\S]*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { re: new RegExp("^" + src + "$"), order, out };
  })
  // Сначала самые длинные шаблоны: они точнее
  .sort((a, b) => b.re.source.length - a.re.source.length);

// Отдельные слова в составных строках («сегодня 12:30 · сообщений: 4»)
const FRAGMENTS: [RegExp, string][] = [
  [/сегодня/g, "today"],
  [/сообщений:/g, "messages:"],
  [/— строка (\d+)/g, "— line $1"],
];

const cache = new Map<string, string>();

function translateCore(s: string): string {
  const exact = EXACT[s];
  if (exact !== undefined) return exact;
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    let out = p.out;
    p.order.forEach((n, i) => {
      // Вставленное значение тоже может быть русской фразой
      out = out.replace(`{${n}}`, translateCore(m[i + 1]));
    });
    return out;
  }
  // Склеенный текст: переводим по строкам
  if (s.includes("\n")) return s.split("\n").map((line) => (CYR.test(line) ? t(line) : line)).join("\n");
  let out = s;
  for (const [re, rep] of FRAGMENTS) out = out.replace(re, rep);
  // Отдельные известные слова («файлах», «совпадения») внутри составной строки
  if (CYR.test(out) && /\s/.test(out)) {
    out = out.replace(/[А-Яа-яЁё][А-Яа-яЁё-]*/g, (w) => EXACT[w] ?? w);
  }
  return out;
}

/** Перевести строку интерфейса на текущий язык. */
export function t(s: string): string {
  if (lang === "ru" || !s || !CYR.test(s)) return s;
  const hit = cache.get(s);
  if (hit !== undefined) return hit;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const out = m[1] + translateCore(m[2]) + m[3];
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}

// Чужой текст не трогаем: код, терминал, сообщения чата, имена файлов, поля ввода
const SKIP =
    ".monaco-editor, .xterm, .chat-user-text, .chat-para, .chat-h, .chat-li, .chat-code, .chat-context, .md-preview, .html-preview, .agent-pre, " +
  ".tree-label, .search-preview, .search-file-name, .search-file-dir, .git-file-name, .tab-label, pre, code, iframe, [data-no-translate], [contenteditable]";
const ATTRS = ["title", "placeholder", "aria-label"];

function skipped(el: Element | null): boolean {
  return !!el && (el.closest(SKIP) !== null || el.tagName === "TEXTAREA" || el.tagName === "SCRIPT" || el.tagName === "STYLE");
}

function fixText(node: Text) {
  const v = node.nodeValue;
  if (!v || !CYR.test(v) || skipped(node.parentElement)) return;
  const out = t(v);
  if (out !== v) node.nodeValue = out;
}

function fixAttrs(el: Element) {
  if (skipped(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && CYR.test(v)) {
      const out = t(v);
      if (out !== v) el.setAttribute(a, out);
    }
  }
  if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit") && CYR.test(el.value)) {
    el.value = t(el.value);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (skipped(el)) return;
  fixAttrs(el);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) fixText(n as Text);
    else fixAttrs(n as Element);
  }
}

let started = false;

/** Включить перевод окна. Для русского ничего не делает. */
export function startTranslator() {
  if (started || lang === "ru") return;
  started = true;
  document.documentElement.lang = "en";
  walk(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") fixText(r.target as Text);
      else if (r.type === "attributes") fixAttrs(r.target as Element);
      else r.addedNodes.forEach(walk);
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/** Язык ответов ИИ: из настройки, а если она пустая — язык интерфейса. */
export function aiLanguage(value: string | undefined): string {
  return value?.trim() || (lang === "en" ? "English" : "русский");
}
