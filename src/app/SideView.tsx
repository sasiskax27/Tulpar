// Боковая панель: файлы, поиск, Git, сборка или чат — что выбрано в полосе слева.
import { Match, Switch } from "solid-js";
import Explorer from "../explorer/Explorer";
import SearchPanel from "../search/SearchPanel";
import GitPanel from "../git/GitPanel";
import ChatPanel from "../ai/ChatPanel";
import BuildPanel from "../tasks/BuildPanel";
import OutlinePanel from "../editor/OutlinePanel";
import ExtensionsPanel from "../extensions/ExtensionsPanel";
import PackagesPanel from "../packages/PackagesPanel";
import TestsPanel from "../testing/TestsPanel";
import DatabasesPanel from "../databases/DatabasesPanel";
import { sidebarView } from "./ui";

export default function SideView() {
  return (
    <Switch>
      <Match when={sidebarView() === "search"}>
        <SearchPanel />
      </Match>
      <Match when={sidebarView() === "git"}>
        <GitPanel />
      </Match>
      <Match when={sidebarView() === "outline"}>
        <OutlinePanel />
      </Match>
      <Match when={sidebarView() === "build"}>
        <BuildPanel />
      </Match>
      <Match when={sidebarView() === "databases"}>
        <DatabasesPanel />
      </Match>
      <Match when={sidebarView() === "tests"}>
        <TestsPanel />
      </Match>
      <Match when={sidebarView() === "packages"}>
        <PackagesPanel />
      </Match>
      <Match when={sidebarView() === "extensions"}>
        <ExtensionsPanel />
      </Match>
      <Match when={sidebarView() === "chat"}>
        <ChatPanel />
      </Match>
      <Match when={true}>
        <Explorer />
      </Match>
    </Switch>
  );
}
