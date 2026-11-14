// Полоса иконок слева: проводник, поиск, настройки.
// Нажатие на активную иконку прячет боковую панель, как в VS Code.
import type { JSX } from "solid-js";
import { executeCommand } from "../commands/registry";
import { sidebarView, sidebarVisible } from "./ui";
import { keybindingFor } from "../keybindings/keybindings";
import { status as gitStatus } from "../git/git";

function Item(props: { view: "explorer" | "search" | "git"; title: string; command: string; badge?: number; children?: JSX.Element }) {
  const active = () => sidebarVisible() && sidebarView() === props.view;
  const hint = () => {
    const k = keybindingFor(props.command);
    return k ? `${props.title} (${k})` : props.title;
  };
  return (
    <button
      class="activity-item"
      classList={{ active: active() }}
      title={hint()}
      aria-label={props.title}
      aria-pressed={active()}
      onClick={() => void executeCommand(props.command, { toggle: true })}
    >
      {props.children}
      {props.badge ? <span class="activity-badge">{props.badge > 99 ? "99+" : props.badge}</span> : null}
    </button>
  );
}

export default function ActivityBar() {
  return (
    <nav class="activity-bar" aria-label="Панели">
      <Item view="explorer" title="Проводник" command="workbench.view.explorer">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      </Item>
      <Item view="search" title="Поиск" command="workbench.view.search">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M20 20l-4.8-4.8" />
        </svg>
      </Item>
      <Item view="git" title="Git" command="workbench.view.scm" badge={gitStatus()?.files.length}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="18" cy="8" r="2.2" />
          <path d="M6 7.2v9.6M18 10.2c0 4.5-6 3.5-11 6.6" />
        </svg>
      </Item>
      <div class="activity-spacer" />
      <button
        class="activity-item"
        title="Настройки"
        aria-label="Настройки"
        onClick={() => void executeCommand("workbench.action.openSettings")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      </button>
    </nav>
  );
}
