// Сеансы терминала. Каждый сеанс — экземпляр xterm.js (тот же терминал, что в VS Code),
// связанный с оболочкой в ядре. Сеансы живут здесь, а не в компоненте панели,
// поэтому скрытие панели не убивает оболочку и не теряет историю.
import { createEffect, createRoot, createSignal, type Accessor } from "solid-js";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { core, events, baseName } from "../ipc";
import { settings } from "../config/store";
import { terminalTheme } from "../app/themes";
import { feedTerminal, resetTerminalErrors } from "../problems/problems";
import { root } from "../app/workspace";
import { notifyError } from "../app/notify";
import { bottomTab, bottomVisible, setBottomTab, setBottomVisible } from "../app/ui";
import { focusEditor } from "../editor/instance";

export interface Session {
  id: string;
  title: Accessor<string>;
  term: Terminal;
  fit: FitAddon;
  /** Свой DOM-узел сеанса: панель вставляет его к себе, когда сеанс активен */
  el: HTMLDivElement;
  opened: boolean;
}

const isMac = navigator.userAgent.includes("Mac");

const [sessions, setSessions] = createSignal<Session[]>([]);
const [activeId, setActiveId] = createSignal<string | null>(null);
export { sessions, activeId, setActiveId };

const byId = new Map<string, Session>();

export function activeSession(): Session | undefined {
  return sessions().find((s) => s.id === activeId());
}

const darkTheme: ITheme = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#cccccc",
  selectionBackground: "#264f78",
};

const lightTheme: ITheme = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#333333",
  selectionBackground: "#add6ff",
  black: "#000000", red: "#cd3131", green: "#008000", yellow: "#949800",
  blue: "#0451a5", magenta: "#bc05bc", cyan: "#0598bc", white: "#555555",
  brightBlack: "#666666", brightRed: "#cd3131", brightGreen: "#14ce14", brightYellow: "#b5ba00",
  brightBlue: "#0451a5", brightMagenta: "#bc05bc", brightCyan: "#0598bc", brightWhite: "#a5a5a5",
};

function appearance() {
  const s = settings();
  return {
    fontFamily: s["editor.fontFamily"],
    fontSize: s["terminal.integrated.fontSize"],
    theme: terminalTheme(String(s["workbench.colorTheme"])) ?? (s["workbench.colorTheme"] === "light" ? lightTheme : darkTheme),
  };
}

/** Подогнать число строк и столбцов под размер панели. */
export function refit(session = activeSession()) {
  if (!session || !session.opened || !session.el.isConnected) return;
  if (session.el.clientWidth === 0 || session.el.clientHeight === 0) return; // панель скрыта (например, открыт чат)
  try {
    session.fit.fit();
    session.term.refresh(0, session.term.rows - 1);
  } catch {
    // панель ещё не получила размер — подгоним при следующем изменении
  }
}

/** title — своё имя вкладки (например, «Задача»); иначе — имя оболочки. */
export async function createSession(fixedTitle?: string): Promise<void> {
  const id = crypto.randomUUID();
  const term = new Terminal({ ...appearance(), cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const el = document.createElement("div");
  el.className = "terminal-instance";
  const [title, setTitle] = createSignal(fixedTitle ?? "терминал");
  const session: Session = { id, title, term, fit, el, opened: false };

  term.onData((data) => {
    // Enter — новая команда: старые ошибки этого терминала больше не актуальны
    if (data.includes("\r")) resetTerminalErrors(id);
    void core.terminalWrite(id, data).catch(() => undefined);
  });
  term.onResize(({ cols, rows }) => void core.terminalResize(id, cols, rows).catch(() => undefined));

  // Копирование и вставка. Ctrl+C копирует, только если что-то выделено, —
  // иначе это обычное «прервать программу».
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.code === "KeyC" && (term.hasSelection() || (!isMac && e.shiftKey))) {
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
        term.clearSelection();
      }
      return false;
    }
    // Вставку делает сам веб-движок: xterm получит событие paste
    if (mod && e.code === "KeyV") return false;
    return true;
  });

  byId.set(id, session);
  setSessions((list) => [...list, session]);
  setActiveId(id);

  try {
    const shell = await core.terminalStart(id, settings()["terminal.integrated.shell"], root(), term.cols, term.rows);
    if (!fixedTitle) setTitle(baseName(shell).replace(/\.exe$/i, ""));
    // Панель могла изменить размер, пока оболочка запускалась
    await core.terminalResize(id, term.cols, term.rows);
  } catch (e) {
    removeSession(id);
    notifyError("Терминал не запустился", e);
  }
}

function removeSession(id: string) {
  const session = byId.get(id);
  if (!session) return;
  byId.delete(id);
  session.term.dispose();
  session.el.remove();
  const rest = sessions().filter((s) => s.id !== id);
  setSessions(rest);
  if (activeId() === id) setActiveId(rest.at(-1)?.id ?? null);
  if (rest.length === 0) {
    setBottomVisible(false);
    focusEditor();
  }
}

/** Закрыть терминал: завершаем оболочку, запись уберётся по событию terminal:exit. */
export function killSession(id: string | null = activeId()) {
  if (id) void core.terminalKill(id).catch(() => removeSession(id));
}

function isTerminalFocused(): boolean {
  return !!document.activeElement?.closest(".terminal-instance");
}

export function focusTerminal() {
  activeSession()?.term.focus();
}

/** Ctrl+`: показать терминал, перейти в него или скрыть, если мы уже в нём. */
export function toggleTerminal() {
  if (!bottomVisible() || bottomTab() !== "terminal") {
    setBottomTab("terminal");
    setBottomVisible(true); // панель при появлении сама создаст первый сеанс и возьмёт фокус
    requestAnimationFrame(() => focusTerminal());
  } else if (isTerminalFocused()) {
    setBottomVisible(false);
    focusEditor();
  } else {
    focusTerminal();
  }
}

/** Открыть новый терминал и выполнить в нём команду (например, установку). */
/** Выполнить команду в терминале. С title — в терминале с этим именем
 *  (повторные запуски идут туда же, а не плодят вкладки). */
export async function runInTerminal(command: string, title?: string) {
  setBottomTab("terminal");
  const existing = title ? sessions().find((s) => s.title() === title) : undefined;
  if (existing) {
    setActiveId(existing.id);
    setBottomVisible(true);
  } else {
    const started = createSession(title);
    setBottomVisible(true);
    await started;
  }
  const id = activeId();
  if (id) {
    resetTerminalErrors(id);
    await core.terminalWrite(id, command + "\r").catch(() => undefined);
  }
}

export function newTerminal() {
  setBottomTab("terminal");
  const started = createSession(); // сеанс уже в списке к моменту появления панели
  setBottomVisible(true);
  return started;
}

export async function initTerminals() {
  // После перезагрузки интерфейса в ядре могли остаться оболочки без окна
  await core.terminalReset().catch(() => undefined);
  await events.onTerminalData((id, data) => {
    byId.get(id)?.term.write(data);
    feedTerminal(id, data);
  });
  await events.onTerminalExit(removeSession);

  // Шрифт и тема из settings.json применяются на лету
  createRoot(() => {
    createEffect(() => {
      const look = appearance();
      for (const s of byId.values()) {
        s.term.options.fontFamily = look.fontFamily;
        s.term.options.fontSize = look.fontSize;
        s.term.options.theme = look.theme;
      }
      refit();
    });
  });
}

/** Прервать то, что выполняется в терминале с этим именем (Ctrl+C). */
export function interruptTerminal(title: string): boolean {
  const s = sessions().find((x) => x.title() === title);
  if (!s) return false;
  void core.terminalWrite(s.id, "\x03").catch(() => undefined);
  return true;
}
