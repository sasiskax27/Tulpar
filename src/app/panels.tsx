// Реестр панелей: id из layout.json → компонент.
// Новые панели (поиск, git, терминал, агенты) добавляются сюда одной строкой.
import type { Component } from "solid-js";
import Explorer from "../explorer/Explorer";
import EditorGroup from "../editor/EditorGroup";

export const panels: Record<string, Component> = {
  explorer: Explorer,
  editor: EditorGroup,
};

export function UnknownPanel(props: { id: string }) {
  return <div class="panel-missing">Панели «{props.id}» пока нет</div>;
}
