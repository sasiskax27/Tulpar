// Сниппеты — заготовки кода: набираешь «main» или «for», выбираешь в подсказках,
// и вставляется готовый кусок с местами для ввода (Tab — к следующему месту).
// Встроенные — для популярных языков; свои — в snippets.json (формат VS Code).
import { monaco } from "./monaco";
import { userSnippets, type UserSnippet } from "../config/store";
import { extSnippets } from "../extensions/extensions";

type Snip = { prefix: string; body: string; description: string };

const BUILTIN: Record<string, Snip[]> = {
  python: [
    { prefix: "main", description: "Точка входа", body: 'def main():\n    ${1:pass}\n\n\nif __name__ == "__main__":\n    main()\n' },
    { prefix: "def", description: "Функция", body: "def ${1:name}(${2:args}):\n    ${3:pass}" },
    { prefix: "class", description: "Класс", body: "class ${1:Name}:\n    def __init__(self${2:, args}):\n        ${3:pass}" },
    { prefix: "for", description: "Цикл for", body: "for ${1:item} in ${2:items}:\n    ${3:pass}" },
    { prefix: "fori", description: "Цикл по числам", body: "for ${1:i} in range(${2:10}):\n    ${3:pass}" },
    { prefix: "while", description: "Цикл while", body: "while ${1:condition}:\n    ${2:pass}" },
    { prefix: "if", description: "Условие", body: "if ${1:condition}:\n    ${2:pass}" },
    { prefix: "ifelse", description: "Условие с else", body: "if ${1:condition}:\n    ${2:pass}\nelse:\n    ${3:pass}" },
    { prefix: "try", description: "Обработка ошибок", body: "try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:e}:\n    ${4:print(e)}" },
    { prefix: "with", description: "Открыть файл", body: 'with open("${1:file.txt}", encoding="utf-8") as ${2:f}:\n    ${3:data = f.read()}' },
    { prefix: "input", description: "Ввод числа", body: '${1:n} = int(input("${2:Введите число: }"))' },
    { prefix: "dataclass", description: "Класс данных", body: "from dataclasses import dataclass\n\n\n@dataclass\nclass ${1:Name}:\n    ${2:field}: ${3:str}" },
    { prefix: "lc", description: "Генератор списка", body: "[${1:x} for ${1:x} in ${2:items}${3: if ${4:condition}}]" },
  ],
  javascript: [
    { prefix: "log", description: "console.log", body: "console.log(${1});" },
    { prefix: "fn", description: "Функция", body: "function ${1:name}(${2:args}) {\n  ${3}\n}" },
    { prefix: "af", description: "Стрелочная функция", body: "const ${1:name} = (${2:args}) => {\n  ${3}\n};" },
    { prefix: "for", description: "Цикл for", body: "for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n  ${3}\n}" },
    { prefix: "forof", description: "Цикл for…of", body: "for (const ${1:item} of ${2:items}) {\n  ${3}\n}" },
    { prefix: "if", description: "Условие", body: "if (${1:condition}) {\n  ${2}\n}" },
    { prefix: "try", description: "try…catch", body: "try {\n  ${1}\n} catch (${2:error}) {\n  console.error(${2:error});\n}" },
    { prefix: "fetch", description: "Запрос fetch", body: 'const ${1:res} = await fetch("${2:url}");\nconst ${3:data} = await ${1:res}.json();' },
    { prefix: "class", description: "Класс", body: "class ${1:Name} {\n  constructor(${2}) {\n    ${3}\n  }\n}" },
    { prefix: "imp", description: "import", body: 'import ${2:name} from "${1:module}";' },
  ],
  html: [
    { prefix: "html5", description: "Шаблон страницы", body: '<!DOCTYPE html>\n<html lang="${1:ru}">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${2:Документ}</title>\n  <link rel="stylesheet" href="${3:style.css}">\n</head>\n<body>\n  ${0}\n  <script src="${4:script.js}"></script>\n</body>\n</html>' },
    { prefix: "link", description: "Подключить CSS", body: '<link rel="stylesheet" href="${1:style.css}">' },
    { prefix: "script", description: "Подключить JS", body: '<script src="${1:script.js}"></script>' },
    { prefix: "a", description: "Ссылка", body: '<a href="${1:#}">${2:текст}</a>' },
    { prefix: "img", description: "Картинка", body: '<img src="${1:image.png}" alt="${2:описание}">' },
    { prefix: "ul", description: "Список", body: "<ul>\n  <li>${1}</li>\n  <li>${2}</li>\n</ul>" },
    { prefix: "form", description: "Форма", body: '<form action="${1:#}" method="${2:post}">\n  <input type="${3:text}" name="${4:name}" placeholder="${5:Имя}">\n  <button type="submit">${6:Отправить}</button>\n</form>' },
  ],
  css: [
    { prefix: "flex", description: "Flex-контейнер", body: "display: flex;\njustify-content: ${1:center};\nalign-items: ${2:center};\ngap: ${3:8px};" },
    { prefix: "grid", description: "Grid-сетка", body: "display: grid;\ngrid-template-columns: ${1:repeat(3, 1fr)};\ngap: ${2:16px};" },
    { prefix: "media", description: "Адаптив @media", body: "@media (max-width: ${1:768px}) {\n  ${2}\n}" },
    { prefix: "center", description: "Центрировать", body: "display: grid;\nplace-items: center;" },
  ],
  java: [
    { prefix: "main", description: "Метод main", body: "public static void main(String[] args) {\n    ${0}\n}" },
    { prefix: "sout", description: "System.out.println", body: "System.out.println(${1});" },
    { prefix: "class", description: "Класс", body: "public class ${1:Main} {\n    ${0}\n}" },
    { prefix: "fori", description: "Цикл for", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${0}\n}" },
    { prefix: "foreach", description: "Цикл for-each", body: "for (${1:var} ${2:item} : ${3:items}) {\n    ${0}\n}" },
    { prefix: "scanner", description: "Ввод с клавиатуры", body: "Scanner ${1:scanner} = new Scanner(System.in);\nint ${2:n} = ${1:scanner}.nextInt();" },
  ],
  cpp: [
    { prefix: "main", description: "Программа", body: "#include <iostream>\nusing namespace std;\n\nint main() {\n    ${0}\n    return 0;\n}" },
    { prefix: "cout", description: "Вывод", body: "cout << ${1} << endl;" },
    { prefix: "cin", description: "Ввод", body: "cin >> ${1};" },
    { prefix: "for", description: "Цикл for", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${0}\n}" },
  ],
  c: [
    { prefix: "main", description: "Программа", body: "#include <stdio.h>\n\nint main(void) {\n    ${0}\n    return 0;\n}" },
    { prefix: "printf", description: "Вывод", body: 'printf("${1:%d}\\n", ${2});' },
    { prefix: "for", description: "Цикл for", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${0}\n}" },
  ],
  rust: [
    { prefix: "main", description: "fn main", body: "fn main() {\n    ${0}\n}" },
    { prefix: "fn", description: "Функция", body: "fn ${1:name}(${2}) ${3:-> ${4:()} }{\n    ${0}\n}" },
    { prefix: "struct", description: "Структура", body: "#[derive(Debug)]\nstruct ${1:Name} {\n    ${2:field}: ${3:String},\n}" },
    { prefix: "test", description: "Тест", body: "#[test]\nfn ${1:it_works}() {\n    ${0}\n}" },
  ],
  go: [
    { prefix: "main", description: "Программа", body: 'package main\n\nimport "fmt"\n\nfunc main() {\n\t${0}\n}' },
    { prefix: "func", description: "Функция", body: "func ${1:name}(${2}) ${3}{\n\t${0}\n}" },
    { prefix: "iferr", description: "Проверка ошибки", body: "if err != nil {\n\treturn ${1:err}\n}" },
  ],
  csharp: [
    { prefix: "cw", description: "Console.WriteLine", body: "Console.WriteLine(${1});" },
    { prefix: "class", description: "Класс", body: "public class ${1:Name}\n{\n    ${0}\n}" },
    { prefix: "for", description: "Цикл for", body: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++)\n{\n    ${0}\n}" },
  ],
};
BUILTIN.typescript = BUILTIN.javascript;
BUILTIN.javascriptreact = BUILTIN.javascript;
BUILTIN.typescriptreact = BUILTIN.javascript;
BUILTIN.scss = BUILTIN.css;
BUILTIN.less = BUILTIN.css;

function userFor(language: string): Snip[] {
  const out: Snip[] = [];
  for (const [name, s] of Object.entries(userSnippets() as Record<string, UserSnippet>)) {
    if (!s || !s.prefix || !s.body) continue;
    const scopes = (s.scope ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (scopes.length && !scopes.includes(language)) continue;
    const body = Array.isArray(s.body) ? s.body.join("\n") : String(s.body);
    for (const prefix of Array.isArray(s.prefix) ? s.prefix : [s.prefix]) {
      out.push({ prefix, body, description: s.description ?? name });
    }
  }
  // Сниппеты из расширений Open VSX
  for (const s of extSnippets()) {
    const scopes = s.language.split(",").map((x) => x.trim());
    if (!scopes.includes(language)) continue;
    const body = Array.isArray(s.body) ? s.body.join("\n") : String(s.body);
    for (const prefix of Array.isArray(s.prefix) ? s.prefix : [s.prefix]) out.push({ prefix, body, description: s.description ?? prefix });
  }
  return out;
}

export function registerSnippets() {
  monaco.languages.registerCompletionItemProvider("*" as any, {
    provideCompletionItems(model, position) {
      const language = model.getLanguageId();
      const list = [...userFor(language), ...(BUILTIN[language] ?? [])];
      if (!list.length) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return {
        suggestions: list.map((s) => ({
          label: { label: s.prefix, description: s.description },
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: { value: "```\n" + s.body.replace(/\$\{\d+:?([^}]*)\}/g, "$1").replace(/\$\d/g, "") + "\n```" },
          detail: "Сниппет",
          range,
          sortText: "~" + s.prefix,
        })),
      };
    },
  });
}
