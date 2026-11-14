// Тесты разбора и записи сочетаний клавиш.
import { describe, expect, it } from "vitest";
import { formatStrokes, keybindingList, normalizeStroke, strokeFromEvent } from "./keybindings";

describe("normalizeStroke", () => {
  it("приводит порядок модификаторов к ctrl, shift, alt, meta", () => {
    expect(normalizeStroke("Shift+Ctrl+P")).toBe("ctrl+shift+p");
    expect(normalizeStroke("alt+ctrl+Delete")).toBe("ctrl+alt+delete");
  });

  it("понимает mod, cmd, win и option", () => {
    // На Windows/Linux "mod" — это Ctrl, а cmd/win — meta.
    expect(normalizeStroke("mod+s")).toBe("ctrl+s");
    expect(normalizeStroke("cmd+s")).toBe("meta+s");
    expect(normalizeStroke("win+s")).toBe("meta+s");
    expect(normalizeStroke("option+ArrowUp")).toBe("alt+arrowup");
  });

  it("normalizeStroke разбирает одно нажатие; аккорд — это два вызова", () => {
    expect(normalizeStroke("ctrl+k")).toBe("ctrl+k");
    expect(normalizeStroke("ctrl+o")).toBe("ctrl+o");
    expect(normalizeStroke("ctrl+k ctrl+o")).not.toBe("ctrl+k ctrl+o");
  });

  it("имена кодов клавиш раскрывает strokeFromEvent, не normalizeStroke", () => {
    expect(normalizeStroke("ctrl+Comma")).toBe("ctrl+comma");
    expect(strokeFromEvent({ code: "Comma", key: ",", ctrlKey: true } as KeyboardEvent)).toBe("ctrl+,");
  });
});

describe("strokeFromEvent", () => {
  const press = (init: Partial<KeyboardEvent>) => strokeFromEvent(init as KeyboardEvent);

  it("читает физическую клавишу — раскладка не важна", () => {
    // Русская раскладка: e.key = "з", но code — KeyP.
    expect(press({ code: "KeyP", key: "з", ctrlKey: true })).toBe("ctrl+p");
  });

  it("собирает модификаторы", () => {
    // Порядок модификаторов в коде: ctrl, shift, alt, meta.
    expect(press({ code: "Digit1", key: "!", shiftKey: true, altKey: true })).toBe("shift+alt+1");
    expect(press({ code: "KeyS", key: "ы", metaKey: true, ctrlKey: true })).toBe("ctrl+meta+s");
  });

  it("F-клавиши и спецклавиши", () => {
    expect(press({ code: "F5", key: "F5" })).toBe("f5");
    expect(press({ code: "Enter", key: "Enter" })).toBe("enter");
    expect(press({ code: "Numpad3", key: "3" })).toBe("numpad3");
  });

  it("чистый модификатор — не сочетание", () => {
    expect(press({ code: "ShiftLeft", key: "Shift" })).toBeNull();
    expect(press({ code: "", key: "" })).toBeNull();
  });
});

describe("formatStrokes", () => {
  it("одиночные нажатия и аккорды", () => {
    expect(formatStrokes(["ctrl+shift+p"])).toBe("Ctrl+Shift+P");
    expect(formatStrokes(["ctrl+k", "ctrl+o"])).toBe("Ctrl+K Ctrl+O");
    expect(formatStrokes(["meta+,"])).toContain("Win");
  });
});

describe("keybindingList", () => {
  it("возвращает действующие сочетания с командами", () => {
    const list = keybindingList();
    expect(list.length).toBeGreaterThan(20);
    expect(list.some((b) => b.command === "workbench.action.openSettings")).toBe(true);
    for (const b of list) expect(b.command).toBeTruthy();
  });
});
