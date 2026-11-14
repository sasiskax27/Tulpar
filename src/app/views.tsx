// Разделы боковой панели и их иконки. Общие для полосы иконок (Дизайн 1)
// и переключателя внутри бокового острова (Дизайн 2).
import { For, type JSX } from "solid-js";
import { executeCommand } from "../commands/registry";
import { keybindingFor } from "../keybindings/keybindings";
import { status as gitStatus } from "../git/git";
import { bottomTab, bottomVisible, sidebarView, sidebarVisible, type SidebarView } from "./ui";
import { settings } from "../config/store";

const svg = (children: JSX.Element, size = 20) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    {children}
  </svg>
);

export const icons = {
  explorer: (size?: number) => svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>, size),
  search: (size?: number) => svg(<><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" /></>, size),
  git: (size?: number) => svg(<><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 7.2v9.6M18 10.2c0 4.5-6 3.5-11 6.6" /></>, size),
  chat: (size?: number) => svg(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></>, size),
  terminal: (size?: number) => svg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9l3 3-3 3M12.5 15H17" /></>, size),
  settings: (size?: number) => svg(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>, size),
  outline: (size?: number) => svg(<><path d="M4 6h16M8 12h12M8 18h12" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>, size),
  build: (size?: number) => svg(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>, size),
  extensions: (size?: number) => svg(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M17 3.5v7M13.5 7h7" /></>, size),
  packages: (size?: number) => svg(<><path d="M4 7.5L12 3l8 4.5-8 4.5z" /><path d="M4 7.5v9L12 21l8-4.5v-9" /><path d="M8 5.3l8 4.5" /></>, size),
  sidebar: (size?: number) => svg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></>, size),
};

export interface ViewDef {
  view: SidebarView;
  title: string;
  command: string;
  icon: (size?: number) => JSX.Element;
  badge?: () => number | undefined;
}

/** Раздел сейчас открыт? Чат может жить внизу — тогда смотрим на нижнюю панель. */
export function isViewActive(view: SidebarView): boolean {
  if (view === "chat" && settings()["tulpar.chat.location"] !== "sidebar") return bottomVisible() && bottomTab() === "chat";
  return sidebarVisible() && sidebarView() === view;
}

export const VIEWS: ViewDef[] = [
  { view: "explorer", title: "Файлы", command: "workbench.view.explorer", icon: icons.explorer },
  { view: "search", title: "Поиск", command: "workbench.view.search", icon: icons.search },
  { view: "git", title: "Git", command: "workbench.view.scm", icon: icons.git, badge: () => gitStatus()?.files.length },
  { view: "outline", title: "Структура", command: "outline.focus", icon: icons.outline },
  { view: "build", title: "Сборка", command: "workbench.view.build", icon: icons.build },
  { view: "packages", title: "Библиотеки", command: "workbench.view.packages", icon: icons.packages },
  { view: "extensions", title: "Расширения", command: "workbench.view.extensions", icon: icons.extensions },
  { view: "chat", title: "Чат с ИИ", command: "workbench.action.chat.open", icon: icons.chat },
];

export function hint(title: string, command: string) {
  const k = keybindingFor(command);
  return k ? `${title} (${k})` : title;
}

export function Badge(props: { count?: number }) {
  return <>{props.count ? <span class="activity-badge">{props.count > 99 ? "99+" : props.count}</span> : null}</>;
}

/** Переключатель разделов в виде сегментов — для верха бокового острова. */
export function ViewSwitcher() {
  return (
    <div class="view-switcher" role="tablist" aria-label="Разделы">
      <For each={VIEWS}>
        {(v) => (
          <button
            class="view-switch"
            classList={{ active: isViewActive(v.view) }}
            role="tab"
            aria-selected={sidebarView() === v.view}
            title={hint(v.title, v.command)}
            onClick={() => void executeCommand(v.command)}
          >
            {v.icon(16)}
            <span>{v.title}</span>
            <Badge count={v.badge?.()} />
          </button>
        )}
      </For>
    </div>
  );
}
