// Встроенные инструменты в правой половине.
import { Match, Switch } from "solid-js";
import type { ToolId } from "../editor/side";
import HttpClient from "./HttpClient";
import RegexLab from "./RegexLab";
import TodoBoard from "./TodoBoard";
import HistoryView from "./HistoryView";
import StatsView from "./StatsView";
import Toolbox from "./Toolbox";
import EnvView from "./EnvView";
import GenerateView from "./GenerateView";
import ReviewView from "./ReviewView";
import CollabView from "../collab/CollabView";
import CsvView from "./CsvView";
import BattleView from "../hype/BattleView";
import AchievementsView from "../hype/AchievementsView";
import GamesHub from "../games/GamesHub";
import TypingGame from "../games/TypingGame";
import BugHunt from "../games/BugHunt";
import QuizGame from "../games/QuizGame";
import SnakeGame from "../games/SnakeGame";

export default function ToolView(props: { tool: ToolId }) {
  return (
    <Switch>
      <Match when={props.tool === "http"}><HttpClient /></Match>
      <Match when={props.tool === "regex"}><RegexLab /></Match>
      <Match when={props.tool === "todo"}><TodoBoard /></Match>
      <Match when={props.tool === "history"}><HistoryView /></Match>
      <Match when={props.tool === "stats"}><StatsView /></Match>
      <Match when={props.tool === "toolbox"}><Toolbox /></Match>
      <Match when={props.tool === "env"}><EnvView /></Match>
      <Match when={props.tool === "generate"}><GenerateView /></Match>
      <Match when={props.tool === "review"}><ReviewView /></Match>
      <Match when={props.tool === "collab"}><CollabView /></Match>
      <Match when={props.tool === "csv"}><CsvView /></Match>
      <Match when={props.tool === "battle"}><BattleView /></Match>
      <Match when={props.tool === "achievements"}><AchievementsView /></Match>
      <Match when={props.tool === "games"}><GamesHub /></Match>
      <Match when={props.tool === "typing"}><TypingGame /></Match>
      <Match when={props.tool === "bughunt"}><BugHunt /></Match>
      <Match when={props.tool === "quiz"}><QuizGame /></Match>
      <Match when={props.tool === "snake"}><SnakeGame /></Match>
    </Switch>
  );
}
