// Разделы боковой панели и их иконки. Общие для полосы иконок (Дизайн 1)
// и переключателя внутри бокового острова (Дизайн 2).
import { For, type JSX } from "solid-js";
import { executeCommand } from "../commands/registry";
import { keybindingFor } from "../keybindings/keybindings";
import { status as gitStatus } from "../git/git";
import { bottomTab, bottomVisible, sidebarView, sidebarVisible, type SidebarView } from "./ui";
import { settings, updateSetting } from "../config/store";
import { showContextMenu } from "./ContextMenu";

const svg = (children: JSX.Element, size = 20) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    {children}
  </svg>
);

export const icons = {
  store: (size?: number) => svg(<><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M5 12v8h14v-8" /><path d="M10 20v-5h4v5" /></>, size),
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
  tests: (size?: number) => svg(<><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 14h9" /></>, size),
  databases: (size?: number) => svg(<><ellipse cx="12" cy="5.5" rx="7" ry="2.8" /><path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13" /><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>, size),
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
  { view: "databases", title: "Базы данных", command: "workbench.view.databases", icon: icons.databases },
  { view: "tests", title: "Тесты", command: "workbench.view.testing", icon: icons.tests },
  { view: "packages", title: "Библиотеки", command: "workbench.view.packages", icon: icons.packages },
  { view: "extensions", title: "Расширения", command: "workbench.view.extensions", icon: icons.extensions },
  { view: "chat", title: "Чат с ИИ", command: "workbench.action.chat.open", icon: icons.chat },
];

// ---------- какие разделы видны и в каком порядке ----------

const DEFAULT_HIDDEN = ["packages", "databases", "extensions"];

function orderedViews(): ViewDef[] {
  const order = (settings()["workbench.views.order"] ?? []) as string[];
  const rank = (v: ViewDef) => {
    const i = order.indexOf(v.view);
    return i < 0 ? order.length + VIEWS.indexOf(v) : i;
  };
  return [...VIEWS].sort((a, b) => rank(a) - rank(b));
}

const hiddenSet = () => new Set((settings()["workbench.views.hidden"] ?? DEFAULT_HIDDEN) as string[]);

/** Разделы на панели (по порядку пользователя). */
export function visibleViews(): ViewDef[] {
  const hidden = hiddenSet();
  return orderedViews().filter((v) => !hidden.has(v.view));
}

/** Разделы, убранные в меню «⋯». */
export function hiddenViews(): ViewDef[] {
  const hidden = hiddenSet();
  return orderedViews().filter((v) => hidden.has(v.view));
}

export function setViewHidden(view: string, hide: boolean) {
  const set = hiddenSet();
  if (hide) set.add(view);
  else set.delete(view);
  // Хотя бы один раздел остаётся на панели
  if (VIEWS.every((v) => set.has(v.view))) return;
  updateSetting("workbench.views.hidden", [...set]);
}

/** Перетащили раздел from на место раздела to. */
export function moveView(from: string, to: string) {
  if (from === to) return;
  const list = orderedViews().map((v) => v.view as string);
  const i = list.indexOf(from);
  if (i < 0) return;
  list.splice(i, 1);
  const j = list.indexOf(to);
  list.splice(j < 0 ? list.length : j, 0, from);
  updateSetting("workbench.views.order", list);
}

/** Меню «⋯»: спрятанные разделы и настройка панели. */
export function showMoreMenu(e: MouseEvent) {
  const hidden = hiddenViews();
  const items: Parameters<typeof showContextMenu>[1] = hidden.map((v) => ({ label: v.title, run: () => void executeCommand(v.command) }));
  if (hidden.length) items.push("-");
  for (const v of orderedViews()) {
    const isHidden = hiddenSet().has(v.view);
    items.push({ label: `${isHidden ? "☐" : "☑"} ${v.title} на панели`, run: () => setViewHidden(v.view, !isHidden) });
  }
  items.push("-", {
    label: "Вернуть разделы как было",
    run: () => {
      updateSetting("workbench.views.order", []);
      updateSetting("workbench.views.hidden", DEFAULT_HIDDEN);
    },
  });
  showContextMenu(e, items);
}

/** Правый клик по разделу. */
export function showViewMenu(e: MouseEvent, v: ViewDef) {
  showContextMenu(e, [
    { label: `Убрать «${v.title}» в меню ⋯`, run: () => setViewHidden(v.view, true) },
    { label: "Настроить разделы…", run: () => showMoreMenu(e) },
  ]);
}

/** Перетаскивание разделов мышкой: обработчики для кнопки раздела. */
export function viewDnd(v: ViewDef) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer?.setData("application/x-tulpar-view", v.view);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/x-tulpar-view")) {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.add("drop-target");
      }
    },
    onDragLeave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove("drop-target"),
    onDrop: (e: DragEvent) => {
      (e.currentTarget as HTMLElement).classList.remove("drop-target");
      const from = e.dataTransfer?.getData("application/x-tulpar-view");
      if (from) {
        e.preventDefault();
        moveView(from, v.view);
      }
    },
  };
}

/** Активен ли один из спрятанных разделов — подсветить «⋯». */
export const hiddenActive = () => hiddenViews().some((v) => isViewActive(v.view));

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
      <For each={visibleViews()}>
        {(v) => (
          <button
            class="view-switch"
            classList={{ active: isViewActive(v.view) }}
            role="tab"
            aria-selected={sidebarView() === v.view}
            title={hint(v.title, v.command)}
            onClick={() => void executeCommand(v.command)}
            onContextMenu={(e) => showViewMenu(e, v)}
            {...viewDnd(v)}
          >
            {v.icon(16)}
            <span>{v.title}</span>
            <Badge count={v.badge?.()} />
          </button>
        )}
      </For>
      <button class="view-switch view-more" classList={{ active: hiddenActive() }} title="Ещё разделы и настройка панели" aria-label="Ещё разделы" onClick={showMoreMenu}>
        <span class="view-more-dots">⋯</span>
      </button>
    </div>
  );
}
