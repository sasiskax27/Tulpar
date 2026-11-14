// Нижняя панель: терминал (вкладки сеансов) и, если чат живёт внизу, чат с ИИ.
import { createEffect, For, on, onCleanup, onMount, Show, untrack } from "solid-js";
import {
  sessions, activeId, setActiveId, activeSession,
  createSession, killSession, refit,
} from "./sessions";
import { bottomTab, setBottomTab, setBottomVisible } from "../app/ui";
import { settings } from "../config/store";
import ChatPanel, { focusChat, MoveChatButton, NewChatButton } from "../ai/ChatPanel";
import { streaming } from "../ai/chat";
import { focusEditor } from "../editor/instance";

export default function TerminalPanel() {
  let host!: HTMLDivElement;
  const chatHere = () => settings()["tulpar.chat.location"] !== "sidebar";
  const tab = () => (chatHere() ? bottomTab() : "terminal");

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
      if (untrack(tab) === "terminal") session.term.focus();
    });
  });


  // Вернулись на терминал — подогнать размер и взять фокус
  createEffect(
    on(tab, (t) => {
      if (t !== "terminal") return;
      requestAnimationFrame(() => {
        refit();
        activeSession()?.term.focus();
      });
    }, { defer: true }),
  );

  const hide = () => {
    setBottomVisible(false);
    focusEditor();
  };

  return (
    <div class="terminal-panel">
      <div class="terminal-header">
        <div class="bottom-left">
          <Show when={chatHere()}>
            <div class="bottom-switch" role="tablist">
              <button class="bottom-switch-btn" classList={{ active: tab() === "terminal" }} role="tab" onClick={() => setBottomTab("terminal")}>
                Терминал
              </button>
              <button
                class="bottom-switch-btn"
                classList={{ active: tab() === "chat", live: !!streaming() }}
                role="tab"
                onClick={() => {
                  setBottomTab("chat");
                  focusChat();
                }}
              >
                ✦ Чат с ИИ
              </button>
            </div>
          </Show>
          <Show when={tab() === "terminal"}>
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
          </Show>
        </div>
        <div class="terminal-actions">
          <Show
            when={tab() === "terminal"}
            fallback={
              <>
                <MoveChatButton />
                <NewChatButton />
              </>
            }
          >
            <button title="Новый терминал (Ctrl+Shift+`)" onClick={() => void createSession()}>
              +
            </button>
            <button title="Закрыть терминал" onClick={() => killSession()}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.8 7v4M9.2 7v4" />
              </svg>
            </button>
          </Show>
          <button title="Скрыть панель (Ctrl+`)" onClick={hide}>
            ×
          </button>
        </div>
      </div>
      <div ref={host} class="terminal-host" classList={{ hidden: tab() !== "terminal" }} />
      <Show when={tab() === "chat"}>
        <ChatPanel embedded />
      </Show>
    </div>
  );
}
