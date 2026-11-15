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
        {icons.store(20)}
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
