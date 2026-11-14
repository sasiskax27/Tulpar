// Тесты значений по умолчанию: настройки и раскладка.
// Шаблоны проектов не тестируем здесь: их модуль тянет Monaco, который в vitest не резолвится.
import { describe, expect, it } from "vitest";
import { defaultLayout, defaultSettings, defaultLanguages } from "./store";

describe("defaultSettings", () => {
  it("в допустимых пределах", () => {
    expect(defaultSettings["editor.fontSize"]).toBeGreaterThanOrEqual(8);
    expect(defaultSettings["editor.fontSize"]).toBeLessThanOrEqual(40);
    expect(defaultSettings["workbench.radius"]).toBeGreaterThanOrEqual(0);
    expect(defaultSettings["workbench.panelOpacity"]).toBeGreaterThanOrEqual(0.3);
    expect(defaultSettings["workbench.panelOpacity"]).toBeLessThanOrEqual(1);
    expect(defaultSettings["editor.cursorSurroundingLines"]).toBeGreaterThanOrEqual(0);
  });

  it("ИИ по умолчанию выключен, агент — спрашивает разрешение", () => {
    expect(defaultSettings["tulpar.ai.provider"]).toBe("none");
    expect(defaultSettings["tulpar.agent.approve"]).toBe("ask");
    expect(defaultSettings["tulpar.ai.apiKey"]).toBe("");
  });

  it("безопасные значения файлов: без автосохранения и без потери данных", () => {
    expect(defaultSettings["files.autoSave"]).toBe("off");
    expect(defaultSettings["editor.formatOnSave"]).toBe(false);
    expect(defaultSettings["files.trimTrailingWhitespace"]).toBe(false);
  });
});

describe("defaultLayout", () => {
  it("есть раскладка по умолчанию «Код»", () => {
    expect(defaultLayout.layouts["Код"]).toBeTruthy();
    expect(defaultLayout.default).toBe("Код");
  });
});

describe("defaultLanguages", () => {
  it("основные языки имеют сервер и подсказку установки", () => {
    for (const lang of ["rust", "python", "go", "cpp", "c"]) {
      expect(defaultLanguages[lang], lang).toBeTruthy();
    }
    expect(defaultLanguages.python?.install).toBeTruthy();
    expect(defaultLanguages.rust?.command).toBe("rust-analyzer");
  });

  it("у python есть запасные серверы", () => {
    expect((defaultLanguages.python?.alternatives?.length ?? 0)).toBeGreaterThan(0);
  });
});
