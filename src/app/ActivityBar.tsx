// Полоса иконок Дизайна 1. Может стоять слева, справа или быть скрыта
// (настройка workbench.activityBar). Нажатие на активную иконку прячет боковую панель.
import { For } from "solid-js";
import { executeCommand } from "../commands/registry";
import { sidebarView, sidebarVisible } from "./ui";
import { Badge, hint, icons, VIEWS } from "./views";

export default function ActivityBar() {
  return (
    <nav class="activity-bar" aria-label="Панели">
      <div class="activity-mark" title="Tulpar">T</div>
      <For each={VIEWS}>
        {(v) => {
          const active = () => sidebarVisible() && sidebarView() === v.view;
          return (
            <button
              class="activity-item"
              classList={{ active: active() }}
              title={hint(v.title, v.command)}
              aria-label={v.title}
              aria-pressed={active()}
              onClick={() => void executeCommand(v.command, { toggle: true })}
            >
              {v.icon(20)}
              <Badge count={v.badge?.()} />
            </button>
          );
        }}
      </For>
      <div class="activity-spacer" />
      <button
        class="activity-item"
        title={hint("Терминал", "workbench.action.terminal.toggleTerminal")}
        aria-label="Терминал"
        onClick={() => void executeCommand("workbench.action.terminal.toggleTerminal")}
      >
        {icons.terminal(20)}
      </button>
      <button
        class="activity-item"
        title={hint("Настройки", "workbench.action.openSettings")}
        aria-label="Настройки"
        onClick={() => void executeCommand("workbench.action.openSettings")}
      >
        {icons.settings(20)}
      </button>
    </nav>
  );
}
