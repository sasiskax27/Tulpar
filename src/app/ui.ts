// Общие состояния интерфейса, которые нужны нескольким компонентам.
import { createSignal } from "solid-js";

const [sidebarVisible, setSidebarVisible] = createSignal(true);
export { sidebarVisible, setSidebarVisible };

/** Нижняя панель (терминал) скрыта, пока её не позовут: Ctrl+` */
const [bottomVisible, setBottomVisible] = createSignal(false);
export { bottomVisible, setBottomVisible };
