// Точки останова в редакторе: клик слева от номера строки ставит красный
// кружок (как в VS Code). Точки «едут» вместе с кодом при правках.
import { createEffect, createRoot, on } from "solid-js";
import { monaco } from "../editor/monaco";
import { activePath } from "../editor/tabs";
import { breakpointLines, breakpointsVersion, setFileBreakpoints, toggleBreakpoint } from "./debug";

export function registerDebugGutter(editor: monaco.editor.IStandaloneCodeEditor) {
  const bp = editor.createDecorationsCollection();
  const hover = editor.createDecorationsCollection();
  let syncing = false;

  const render = () => {
    const path = activePath();
    const model = editor.getModel();
    if (!path || !model) return bp.clear();
    syncing = true;
    bp.set(
      breakpointLines(path)
        .filter((l) => l <= model.getLineCount())
        .map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            glyphMarginClassName: "debug-breakpoint-glyph",
            glyphMarginHoverMessage: { value: "Точка останова — клик, чтобы убрать" },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })),
    );
    syncing = false;
  };

  createRoot(() => {
    createEffect(on([activePath, breakpointsVersion], () => queueMicrotask(render)));
  });
  editor.onDidChangeModel(() => queueMicrotask(render));

  // Правка кода сдвигает точки — запоминаем их новые строки
  editor.onDidChangeModelContent(() => {
    const path = activePath();
    if (!path || syncing) return;
    setFileBreakpoints(path, bp.getRanges().map((r) => r.startLineNumber));
  });

  const isGutter = (t: monaco.editor.MouseTargetType) =>
    t === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || t === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;

  editor.onMouseDown((e) => {
    if (!e.event.leftButton || !isGutter(e.target.type)) return;
    const line = e.target.position?.lineNumber;
    const path = activePath();
    if (line && path) toggleBreakpoint(path, line);
  });

  // Бледный кружок при наведении — подсказка, что сюда можно кликнуть
  editor.onMouseMove((e) => {
    const line = e.target.position?.lineNumber;
    if (isGutter(e.target.type) && line) {
      hover.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "debug-breakpoint-hint" } }]);
    } else hover.clear();
  });
  editor.onMouseLeave(() => hover.clear());
}
