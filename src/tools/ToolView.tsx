// Встроенные инструменты в правой половине.
import { Match, Switch } from "solid-js";
import type { ToolId } from "../editor/side";
import HttpClient from "./HttpClient";
import RegexLab from "./RegexLab";
import TodoBoard from "./TodoBoard";
import HistoryView from "./HistoryView";
import StatsView from "./StatsView";
import Toolbox from "./Toolbox";

export default function ToolView(props: { tool: ToolId }) {
  return (
    <Switch>
      <Match when={props.tool === "http"}><HttpClient /></Match>
      <Match when={props.tool === "regex"}><RegexLab /></Match>
      <Match when={props.tool === "todo"}><TodoBoard /></Match>
      <Match when={props.tool === "history"}><HistoryView /></Match>
      <Match when={props.tool === "stats"}><StatsView /></Match>
      <Match when={props.tool === "toolbox"}><Toolbox /></Match>
    </Switch>
  );
}
