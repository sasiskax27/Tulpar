// Символы активного файла: обновляются при смене вкладки и после правок.
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { activePath, cursor, modelFor } from "./tabs";
import { editorInstance } from "./instance";
import { documentSymbols, symbolPath, type Sym } from "./symbols";
import { monaco } from "./monaco";

const [symbols, setSymbols] = createSignal<Sym[]>([]);
export { symbols };

let timer: number | undefined;
let sub: monaco.IDisposable | undefined;

async function refresh() {
  const path = activePath();
  const model = path ? modelFor(path) : undefined;
  if (!model) {
    setSymbols([]);
    return;
  }
  const list = await documentSymbols(model);
  if (activePath() === path) setSymbols(list);
}

export function initOutline() {
  createRoot(() => {
    createEffect(
      on(activePath, (path) => {
        sub?.dispose();
        setSymbols([]);
        const model = path ? modelFor(path) : undefined;
        if (!model) return;
        // Языковому серверу нужно время, чтобы открыть файл
        window.setTimeout(() => void refresh(), 400);
        sub = model.onDidChangeContent(() => {
          clearTimeout(timer);
          timer = window.setTimeout(() => void refresh(), 900);
        });
      }),
    );
  });
}

/** Символы, внутри которых сейчас курсор. */
export function currentPath(): Sym[] {
  return symbolPath(symbols(), cursor().line);
}

export function revealSymbol(s: Sym) {
  const editor = editorInstance();
  if (!editor) return;
  editor.setPosition({ lineNumber: s.line, column: s.column });
  editor.revealLineInCenterIfOutsideViewport(s.line);
  editor.focus();
}

export { refresh as refreshOutline };
