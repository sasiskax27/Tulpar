// Общие состояния интерфейса, которые нужны нескольким компонентам.
import { createSignal } from "solid-js";

const [sidebarVisible, setSidebarVisible] = createSignal(true);
export { sidebarVisible, setSidebarVisible };

/** Нижняя панель (терминал) скрыта, пока её не позовут: Ctrl+` */
const [bottomVisible, setBottomVisible] = createSignal(false);
export { bottomVisible, setBottomVisible };

/** Окно настроек (Ctrl+,) */
const [settingsVisible, setSettingsVisible] = createSignal(false);
export { settingsVisible, setSettingsVisible };
/** Какой раздел открыть в настройках при следующем показе. */
const [settingsSection, setSettingsSection] = createSignal("general");
export { settingsSection, setSettingsSection };
export function openSettingsAt(section: string) {
  setSettingsSection(section);
  setSettingsVisible(true);
}

/** Что показано в боковой панели: проводник или поиск */
export type SidebarView = "explorer" | "search" | "git" | "chat" | "build" | "outline" | "extensions" | "packages" | "tests" | "databases";
const [sidebarView, setSidebarView] = createSignal<SidebarView>("explorer");
export { sidebarView, setSidebarView };

/** Что показано в нижней панели: терминал или чат с ИИ (если чат живёт внизу) */
export type BottomTab = "terminal" | "chat" | "problems" | "debug" | "build";
const [bottomTab, setBottomTab] = createSignal<BottomTab>("terminal");
export { bottomTab, setBottomTab };
