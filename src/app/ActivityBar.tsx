// Полоса иконок Дизайна 1. Может стоять слева, справа или быть скрыта
// (настройка workbench.activityBar). Нажатие на активную иконку прячет боковую панель.
import { For } from "solid-js";
import { executeCommand } from "../commands/registry";
import { Badge, hiddenActive, hint, icons, isViewActive, showMoreMenu, showViewMenu, viewDnd, visibleViews } from "./views";

export default function ActivityBar() {
  return (
    <nav class="activity-bar" aria-label="Панели">
      <div class="activity-mark" title="Tulpar">T</div>
      <For each={visibleViews()}>
        {(v) => {
          const active = () => isViewActive(v.view);
          return (
            <button
              class="activity-item"
              classList={{ active: active() }}
              title={hint(v.title, v.command)}
              aria-label={v.title}
              aria-pressed={active()}
              onClick={() => void executeCommand(v.command, { toggle: true })}
              onContextMenu={(e) => showViewMenu(e, v)}
              {...viewDnd(v)}
            >
              {v.icon(20)}
              <Badge count={v.badge?.()} />
            </button>
          );
        }}
      </For>
      <button class="activity-item activity-more" classList={{ active: hiddenActive() }} title="Ещё разделы и настройка панели" aria-label="Ещё разделы" onClick={showMoreMenu}>
        ⋯
      </button>
      <div class="activity-spacer" />
      <button
        class="activity-item"
        title={hint("Магазин Tulpar", "tulpar.store")}
        aria-label="Магазин Tulpar"
        onClick={() => void executeCommand("tulpar.store")}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 12v8h14v-8" /><path d="M10 20v-5h4v5" />
        </svg>
      </button>
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
