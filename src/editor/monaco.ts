// Настройка Monaco — движка редактирования из VS Code.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import type { Settings } from "../config/store";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// Настройки Tulpar и VS Code — это JSON с комментариями и висячими запятыми.
// Без этого Monaco подчёркивает каждый комментарий как ошибку.
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: true,
  trailingCommas: "ignore",
});

export { monaco };

/** Опции Monaco из settings.json. */
export function editorOptions(s: Settings): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  return {
    fontSize: s["editor.fontSize"],
    fontFamily: s["editor.fontFamily"],
    lineHeight: s["editor.lineHeight"],
    tabSize: s["editor.tabSize"],
    insertSpaces: s["editor.insertSpaces"],
    wordWrap: s["editor.wordWrap"],
    minimap: { enabled: s["editor.minimap.enabled"] },
    lineNumbers: s["editor.lineNumbers"],
    cursorBlinking: s["editor.cursorBlinking"],
    theme: s["workbench.colorTheme"] === "light" ? "vs" : "vs-dark",
    automaticLayout: true,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: "on",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: "active", indentation: true },
    renderWhitespace: "selection",
    stickyScroll: { enabled: true },
    scrollBeyondLastLine: true,
    fixedOverflowWidgets: true,
    inlineSuggest: { enabled: true, mode: "subwordSmart" },
  };
}

/** Определение языка по имени файла, расширению и шебангу. */
export function detectLanguage(path: string, firstLine = ""): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === name)) return lang.id;
  }
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.extensions?.some((ext) => name.endsWith(ext.toLowerCase()))) return lang.id;
  }
  const shebang = firstLine.match(/^#!.*\b(python3?|node|bash|sh|zsh|ruby|perl|php)\b/);
  if (shebang) {
    const map: Record<string, string> = {
      python: "python", python3: "python", node: "javascript",
      bash: "shell", sh: "shell", zsh: "shell", ruby: "ruby", perl: "perl", php: "php",
    };
    return map[shebang[1]] ?? "plaintext";
  }
  return "plaintext";
}

/** Человекочитаемое имя языка — для строки статуса. */
export function languageName(id: string): string {
  const lang = monaco.languages.getLanguages().find((l) => l.id === id);
  return lang?.aliases?.[0] ?? id;
}
