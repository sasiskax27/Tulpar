// 💡 Ошибки простыми словами: при наведении на подчёркнутое — объяснение
// по-человечески (для частых ошибок без ИИ) и кнопка «Объяснить с ИИ».
import { monaco } from "../editor/monaco";
import { executeCommand } from "../commands/registry";
import { currentLang, t } from "../i18n/translate";

const KNOWN: [RegExp, string, string][] = [
  [/Cannot find name '(\w+)'|(\w+) is not defined|NameError: name '(\w+)'/i, "Имя «$1$2$3» нигде не объявлено. Опечатка в названии, забытый import или переменная объявлена ниже/в другой функции.", "“$1$2$3” is not declared anywhere. A typo, a missing import, or the variable is declared later / in another function."],
  [/Property '(\w+)' does not exist on type/i, "У этого объекта нет свойства «$1». Проверьте написание или тип объекта — возможно, нужно другое поле.", "This object has no property “$1”. Check the spelling or the object's type — maybe you need another field."],
  [/is possibly 'undefined'|is possibly 'null'|Object is possibly/i, "Значение может отсутствовать (undefined/null). Добавьте проверку if, оператор ?. или значение по умолчанию ??.", "The value may be missing (undefined/null). Add an if check, the ?. operator or a default with ??."],
  [/Type '(.+?)' is not assignable to type '(.+?)'/i, "Типы не совпадают: пытаетесь положить «$1» туда, где ждут «$2».", "Types don't match: you're putting “$1” where “$2” is expected."],
  [/Expected (\d+) arguments?, but got (\d+)/i, "Функция ждёт аргументов: $1, а передано: $2.", "The function expects $1 argument(s), but got $2."],
  [/Cannot find module '(.+?)'/i, "Модуль «$1» не найден. Установите его (вкладка «Библиотеки» или npm install) или проверьте путь.", "Module “$1” not found. Install it (Libraries tab or npm install) or check the path."],
  [/is declared but (its value is )?never (used|read)/i, "Это объявлено, но нигде не используется — можно удалить.", "This is declared but never used — you can remove it."],
  [/Unexpected token|SyntaxError|invalid syntax|expected/i, "Синтаксическая ошибка: где-то рядом пропущена или лишняя скобка, кавычка, запятая или двоеточие.", "Syntax error: a bracket, quote, comma or colon is missing or extra somewhere nearby."],
  [/IndentationError|unexpected indent|unindent/i, "Неправильные отступы. В Python отступы — часть кода: выровняйте строки блока одинаково (обычно 4 пробела).", "Wrong indentation. In Python indentation is part of the code: align the block's lines the same way (usually 4 spaces)."],
  [/Import "(.+?)" could not be resolved|No module named '(.+?)'/i, "Пакет «$1$2» не установлен в окружении Python. Установите его через «Библиотеки» или pip install.", "Package “$1$2” isn't installed in the Python environment. Install it via Libraries or pip install."],
  [/missing return|not all code paths return/i, "Не во всех ветках функция возвращает значение — добавьте return.", "Not every branch of the function returns a value — add a return."],
  [/borrow|moved value|cannot borrow/i, "Rust: значение уже передано или занято другой ссылкой. Используйте &ссылку, .clone() или переставьте строки.", "Rust: the value was moved or is borrowed elsewhere. Use a &reference, .clone() or reorder the lines."],
];

export function plainExplanation(message: string): string | null {
  const en = currentLang() === "en";
  for (const [re, ru, eng] of KNOWN) {
    const text = en ? eng : ru;
    const m = re.exec(message);
    if (m) return text.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? "");
  }
  return null;
}

let registered = false;
export function registerErrorExplain() {
  if (registered) return;
  registered = true;
  monaco.editor.registerCommand("tulpar.explainMarker", (_acc: unknown, arg: { message: string; line: number; code: string; lang: string }) => {
    const prompt = `${t("Объясни простыми словами ошибку и покажи, как исправить.")}\n\nЯзык: ${arg.lang}\nОшибка (строка ${arg.line}): ${arg.message}\n\nКод вокруг:\n\`\`\`${arg.lang}\n${arg.code}\n\`\`\``;
    void executeCommand("workbench.action.chat.open").then(() => import("../ai/chat").then((c) => c.send(prompt)));
  });
  monaco.languages.registerHoverProvider("*", {
    provideHover(model, position) {
      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((m) => m.severity >= monaco.MarkerSeverity.Warning && new monaco.Range(m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn).containsPosition(position));
      if (!markers.length) return null;
      const m = markers[0];
      const from = Math.max(1, m.startLineNumber - 4);
      const to = Math.min(model.getLineCount(), m.endLineNumber + 4);
      const code = model.getValueInRange(new monaco.Range(from, 1, to, model.getLineMaxColumn(to)));
      const arg = encodeURIComponent(JSON.stringify({ message: m.message, line: m.startLineNumber, code, lang: model.getLanguageId() }));
      const plain = plainExplanation(m.message);
      const parts = [];
      if (plain) parts.push({ value: `💡 ${plain}` });
      parts.push({ value: `[${t("✦ Объяснить с ИИ")}](command:tulpar.explainMarker?${arg})`, isTrusted: true });
      return { range: new monaco.Range(m.startLineNumber, m.startColumn, m.endLineNumber, m.endColumn), contents: parts };
    },
  });
}
