// .env: разбор строк, размытие секретов в редакторе, .env.example.
import { monaco } from "../editor/monaco";

export interface EnvLine {
  line: number; // с 1
  key: string;
  value: string;
  /** колонки значения (с 1, конец не включён) */
  start: number;
  end: number;
  comment?: string;
}

export const isEnvFile = (path: string | null | undefined) => !!path && /(^|[\\/])\.env(\.[\w.-]+)?$/i.test(path) && !/\.(example|sample|template)$/i.test(path);

export function parseEnv(text: string): EnvLine[] {
  const out: EnvLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^(\s*(?:export\s+)?)([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/.exec(raw);
    if (!m) return;
    const start = m[1].length + m[2].length + m[3].length + 1;
    let value = m[4];
    let comment: string | undefined;
    // Комментарий после значения без кавычек
    if (!/^["']/.test(value)) {
      const c = value.search(/\s+#/);
      if (c >= 0) {
        comment = value.slice(c).replace(/^\s+#\s*/, "");
        value = value.slice(0, c);
      }
    }
    out.push({ line: i + 1, key: m[2], value, start, end: start + value.length, comment });
  });
  return out;
}

export function unquote(v: string): string {
  const m = /^(["'])([\s\S]*)\1$/.exec(v.trim());
  return m ? m[2] : v.trim();
}

/** Похоже на секрет: ключ со словами KEY/SECRET/TOKEN/PASS или длинное случайное значение. */
export function looksSecret(key: string, value: string): boolean {
  if (/(KEY|SECRET|TOKEN|PASS|PWD|PRIVATE|CREDENTIAL|AUTH|DSN|DATABASE_URL|CONN)/i.test(key)) return unquote(value).length > 0;
  const v = unquote(value);
  return v.length >= 24 && /[A-Za-z]/.test(v) && /\d/.test(v) && !/\s/.test(v);
}

export function toExample(text: string): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const m = /^(\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*=\s*)(.*)$/.exec(raw);
      if (!m) return raw;
      const v = unquote(m[2].replace(/\s+#.*$/, ""));
      // Безобидные значения (порт, режим) оставляем как подсказку
      const keep = /^(\d{1,5}|true|false|development|production|test|localhost|debug|info)$/i.test(v);
      return m[1] + (keep ? v : "");
    })
    .join("\n");
}

/** Размывать секреты в редакторе, кроме строки с курсором. */
export function registerEnvMasking(editor: monaco.editor.IStandaloneCodeEditor, isEnv: (model: monaco.editor.ITextModel) => boolean) {
  const decorations = editor.createDecorationsCollection();
  let revealAll = false;
  const update = () => {
    const model = editor.getModel();
    if (!model || !isEnv(model)) {
      decorations.clear();
      return;
    }
    const cursorLine = editor.getPosition()?.lineNumber ?? -1;
    const list: monaco.editor.IModelDeltaDecoration[] = [];
    if (!revealAll) {
      for (const e of parseEnv(model.getValue())) {
        if (e.line === cursorLine || e.end <= e.start || !looksSecret(e.key, e.value)) continue;
        list.push({
          range: new monaco.Range(e.line, e.start, e.line, e.end),
          options: { inlineClassName: "env-secret", hoverMessage: { value: "Секрет скрыт. Поставьте курсор на строку, чтобы увидеть" } },
        });
      }
    }
    decorations.set(list);
  };
  editor.onDidChangeModel(update);
  editor.onDidChangeModelContent(update);
  editor.onDidChangeCursorPosition(update);
  editor.addAction({
    id: "tulpar.env.toggleSecrets",
    label: "Показать / скрыть секреты в .env",
    run: () => {
      revealAll = !revealAll;
      update();
    },
  });
  update();
}
