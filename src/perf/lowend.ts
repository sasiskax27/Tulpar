// 🪶 Режим для слабых ПК: выключает всё тяжёлое одной кнопкой и
// возвращает как было, когда режим выключают.
import { createEffect, createRoot, on } from "solid-js";
import { settings, updateSetting, type Settings } from "../config/store";
import { notify } from "../app/notify";

const SAVED = "tulpar.lowEnd.saved";

const LIGHT: Partial<Settings> = {
  "editor.minimap.enabled": false,
  "editor.smoothScrolling": false,
  "editor.bracketPairColorization.enabled": false,
  "editor.stickyScroll.enabled": false,
  "editor.occurrencesHighlight": false,
  "editor.cursorBlinking": "solid",
  "editor.renderWhitespace": "none",
  "git.blame.inline": false,
  "workbench.panelBlur": 0,
  "tulpar.background.blur": 0,
  "tulpar.ai.inline": false,
  "tulpar.fun.powerMode": "off",
} as Partial<Settings>;

function apply(on: boolean) {
  const s = settings();
  if (on) {
    const saved: Record<string, unknown> = {};
    for (const k of Object.keys(LIGHT) as (keyof Settings)[]) saved[k] = s[k];
    localStorage.setItem(SAVED, JSON.stringify(saved));
    for (const [k, v] of Object.entries(LIGHT)) updateSetting(k as keyof Settings, v as never);
    notify("🪶 Режим для слабых ПК включён: анимации, размытие, мини-карта и подсказки ИИ при наборе выключены");
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? "{}") as Record<string, unknown>;
      for (const [k, v] of Object.entries(saved)) updateSetting(k as keyof Settings, v as never);
    } catch {
      /* ничего */
    }
    localStorage.removeItem(SAVED);
    notify("Режим для слабых ПК выключен — всё как было");
  }
}

let first = true;
export function initLowEnd() {
  createRoot(() =>
    createEffect(
      on(
        () => settings()["tulpar.lowEnd"] === true,
        (lowEnd, prev) => {
          document.body.classList.toggle("tp-lowend", lowEnd);
          // При запуске только ставим класс; применяем, когда переключили
          if (!first && prev !== undefined && prev !== lowEnd) apply(lowEnd);
          first = false;
        },
      ),
    ),
  );
}

export function toggleLowEnd() {
  updateSetting("tulpar.lowEnd", !settings()["tulpar.lowEnd"]);
}
