// Общие состояния интерфейса, которые нужны нескольким компонентам.
import { createSignal } from "solid-js";

const [sidebarVisible, setSidebarVisible] = createSignal(true);
export { sidebarVisible, setSidebarVisible };
