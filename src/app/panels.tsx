// Реестр панелей: id из layout.json → компонент.
// Новые панели (поиск, git, терминал, агенты) добавляются сюда одной строкой.
import type { Component } from "solid-js";
import SideView from "./SideView";
import SearchPanel from "../search/SearchPanel";
import GitPanel from "../git/GitPanel";
import ChatPanel from "../ai/ChatPanel";
import EditorGroup from "../editor/EditorGroup";
import TerminalPanel from "../terminal/TerminalPanel";

export const panels: Record<string, Component> = {
  explorer: SideView,
  search: SearchPanel,
  git: GitPanel,
  chat: ChatPanel,
  editor: EditorGroup,
  terminal: TerminalPanel,
};

export function UnknownPanel(props: { id: string }) {
  return <div class="panel-missing">Панели «{props.id}» пока нет</div>;
}
