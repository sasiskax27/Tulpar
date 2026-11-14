// Боковая панель: показывает проводник или поиск — что выбрано в полосе слева.
import { Match, Switch } from "solid-js";
import Explorer from "../explorer/Explorer";
import SearchPanel from "../search/SearchPanel";
import { sidebarView } from "./ui";

export default function SideView() {
  return (
    <Switch>
      <Match when={sidebarView() === "search"}>
        <SearchPanel />
      </Match>
      <Match when={true}>
        <Explorer />
      </Match>
    </Switch>
  );
}
