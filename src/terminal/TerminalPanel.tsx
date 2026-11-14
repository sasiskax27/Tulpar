// Панель терминала: вкладки сеансов и место, куда вставляется активный терминал.
import { createEffect, For, onCleanup, onMount } from "solid-js";
import {
  sessions, activeId, setActiveId, activeSession,
  createSession, killSession, refit,
} from "./sessions";
import { setBottomVisible } from "../app/ui";
import { focusEditor } from "../editor/instance";

export default function TerminalPanel() {
  let host!: HTMLDivElement;

  onMount(() => {
    if (sessions().length === 0) void createSession();
    const observer = new ResizeObserver(() => refit());
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  // Показываем активный сеанс: его DOM-узел переезжает в панель
  createEffect(() => {
    const session = activeSession();
    host.replaceChildren();
    if (!session) return;
    host.appendChild(session.el);
    if (!session.opened) {
      session.term.open(session.el);
      session.opened = true;
    }
    requestAnimationFrame(() => {
      refit(session);
      session.term.focus();
    });
  });

  const hide = () => {
    setBottomVisible(false);
    focusEditor();
  };

  return (
    <div class="terminal-panel">
      <div class="terminal-header">
        <div class="terminal-tabs" role="tablist">
          <For each={sessions()}>
            {(s, i) => (
              <button
                class="terminal-tab"
                classList={{ active: s.id === activeId() }}
                role="tab"
                onClick={() => setActiveId(s.id)}
              >
                {i() + 1}: {s.title()}
              </button>
            )}
          </For>
        </div>
        <div class="terminal-actions">
          <button title="Новый терминал (Ctrl+Shift+`)" onClick={() => void createSession()}>
            +
          </button>
          <button title="Закрыть терминал" onClick={() => killSession()}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.8 7v4M9.2 7v4" />
            </svg>
          </button>
          <button title="Скрыть панель (Ctrl+`)" onClick={hide}>
            ×
          </button>
        </div>
      </div>
      <div ref={host} class="terminal-host" />
    </div>
  );
}
