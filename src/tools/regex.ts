// Разбор регулярного выражения для «Лаборатории регулярок».
export interface RegexMatch {
  index: number;
  end: number;
  text: string;
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export function compile(pattern: string, flags: string): { re: RegExp | null; error: string } {
  if (!pattern) return { re: null, error: "" };
  try {
    return { re: new RegExp(pattern, flags.includes("g") ? flags : flags + "g"), error: "" };
  } catch (e) {
    return { re: null, error: (e as Error).message.replace(/^Invalid regular expression: /, "") };
  }
}

export function allMatches(re: RegExp, text: string, limit = 2000): RegexMatch[] {
  const out: RegexMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < limit) {
    out.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups: m.slice(1), named: { ...(m.groups ?? {}) } });
    if (m[0] === "") re.lastIndex++; // пустое совпадение — не зацикливаемся
  }
  return out;
}

/** Текст, нарезанный на куски: совпадение или нет. */
export function segments(text: string, matches: RegexMatch[]): { text: string; hit: number }[] {
  const out: { text: string; hit: number }[] = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.index > pos) out.push({ text: text.slice(pos, m.index), hit: -1 });
    if (m.end > m.index) out.push({ text: text.slice(m.index, m.end), hit: i });
    pos = Math.max(pos, m.end);
  });
  if (pos < text.length) out.push({ text: text.slice(pos), hit: -1 });
  return out;
}

/** Простое объяснение по кусочкам — работает без ИИ. */
const TOKENS: [RegExp, string][] = [
  [/^\\d/, "цифра"], [/^\\D/, "не цифра"], [/^\\w/, "буква, цифра или _"], [/^\\W/, "не буква и не цифра"],
  [/^\\s/, "пробел или перенос"], [/^\\S/, "не пробел"], [/^\\b/, "граница слова"], [/^\\B/, "не граница слова"],
  [/^\\n/, "перенос строки"], [/^\\t/, "табуляция"], [/^\\./, "точка"], [/^\\(.)/, "символ «$1»"],
  [/^\^/, "начало строки"], [/^\$/, "конец строки"], [/^\./, "любой символ"],
  [/^\(\?<(\w+)>/, "начало группы «$1»"], [/^\(\?:/, "начало группы без запоминания"],
  [/^\(\?=/, "дальше должно идти"], [/^\(\?!/, "дальше НЕ должно идти"], [/^\(\?<=/, "перед этим должно быть"], [/^\(\?<!/, "перед этим НЕ должно быть"],
  [/^\(/, "начало группы"], [/^\)/, "конец группы"], [/^\|/, "или"],
  [/^\[\^((?:\\.|[^\]])*)\]/, "любой символ, кроме [$1]"], [/^\[((?:\\.|[^\]])*)\]/, "один из символов [$1]"],
  [/^\{(\d+)\}/, "ровно $1 раз"], [/^\{(\d+),\}/, "от $1 раз и больше"], [/^\{(\d+),(\d+)\}/, "от $1 до $2 раз"],
  [/^\*\?/, "0 или больше раз (как можно меньше)"], [/^\+\?/, "1 или больше раз (как можно меньше)"],
  [/^\*/, "0 или больше раз"], [/^\+/, "1 или больше раз"], [/^\?/, "необязательно"],
];

export function explain(pattern: string): { token: string; meaning: string }[] {
  const out: { token: string; meaning: string }[] = [];
  let s = pattern;
  let guard = 0;
  while (s && guard++ < 500) {
    let done = false;
    for (const [re, meaning] of TOKENS) {
      const m = re.exec(s);
      if (m) {
        out.push({ token: m[0], meaning: meaning.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? "") });
        s = s.slice(m[0].length);
        done = true;
        break;
      }
    }
    if (!done) {
      // Обычные символы склеиваем в одно слово
      const lit = /^[^\\^$.|?*+()[\]{}]+/.exec(s)?.[0] ?? s[0];
      out.push({ token: lit, meaning: `текст «${lit}»` });
      s = s.slice(lit.length);
    }
  }
  return out;
}

export const PRESETS: [string, string][] = [
  ["Email", "[\\w.+-]+@[\\w-]+\\.[\\w.-]+"],
  ["Телефон KZ/RU", "\\+?[78][\\s(-]*\\d{3}[\\s)-]*\\d{3}[\\s-]*\\d{2}[\\s-]*\\d{2}"],
  ["Ссылка", "https?://[^\\s\"'<>]+"],
  ["Число", "-?\\d+(?:[.,]\\d+)?"],
  ["Дата ДД.ММ.ГГГГ", "\\b(\\d{2})\\.(\\d{2})\\.(\\d{4})\\b"],
  ["IPv4", "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"],
  ["HEX-цвет", "#(?:[0-9a-fA-F]{3}){1,2}\\b"],
  ["ИИН (12 цифр)", "\\b\\d{12}\\b"],
];
