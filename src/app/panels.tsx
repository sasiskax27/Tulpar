// Реестр панелей: id из layout.json → компонент.
// Новые панели (поиск, git, терминал, агенты) добавляются сюда одной строкой.
import type { Component } from "solid-js";
import SideView from "./SideView";
import SearchPanel from "../search/SearchPanel";
import GitPanel from "../git/GitPanel";
import ChatPanel from "../ai/ChatPanel";
import EditorGroup from "../editor/EditorGroup";
import TerminalPanel from "../terminal/TerminalPanel";
import BuildPanel from "../tasks/BuildPanel";
import ExtensionsPanel from "../extensions/ExtensionsPanel";
import PackagesPanel from "../packages/PackagesPanel";
import TestsPanel from "../testing/TestsPanel";
import DatabasesPanel from "../databases/DatabasesPanel";

export const panels: Record<string, Component> = {
  explorer: SideView,
  search: SearchPanel,
  git: GitPanel,
  chat: ChatPanel,
  editor: EditorGroup,
  terminal: TerminalPanel,
  build: BuildPanel,
  extensions: ExtensionsPanel,
  packages: PackagesPanel,
  tests: TestsPanel,
  databases: DatabasesPanel,
};

export function UnknownPanel(props: { id: string }) {
  return <div class="panel-missing">Панели «{props.id}» пока нет</div>;
}
