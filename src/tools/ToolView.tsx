// Встроенные инструменты в правой половине. Каждый грузится только когда его открыли.
import { lazy, Match, Switch } from "solid-js";
import type { ToolId } from "../editor/side";
const HttpClient = lazy(() => import("./HttpClient"));
const RegexLab = lazy(() => import("./RegexLab"));
const TodoBoard = lazy(() => import("./TodoBoard"));
const HistoryView = lazy(() => import("./HistoryView"));
const StatsView = lazy(() => import("./StatsView"));
const Toolbox = lazy(() => import("./Toolbox"));
const EnvView = lazy(() => import("./EnvView"));
const GenerateView = lazy(() => import("./GenerateView"));
const ReviewView = lazy(() => import("./ReviewView"));
const CollabView = lazy(() => import("../collab/CollabView"));
const CsvView = lazy(() => import("./CsvView"));
const BattleView = lazy(() => import("../hype/BattleView"));
const AchievementsView = lazy(() => import("../hype/AchievementsView"));
const GamesHub = lazy(() => import("../games/GamesHub"));
const TypingGame = lazy(() => import("../games/TypingGame"));
const BugHunt = lazy(() => import("../games/BugHunt"));
const QuizGame = lazy(() => import("../games/QuizGame"));
const SnakeGame = lazy(() => import("../games/SnakeGame"));
const FlightView = lazy(() => import("../flight/FlightView"));
const DoctorView = lazy(() => import("../doctor/DoctorView"));
const SecurityView = lazy(() => import("../security/SecurityView"));
const DockerView = lazy(() => import("../docker/DockerView"));
const ServersView = lazy(() => import("../servers/ServersView"));
const StoreView = lazy(() => import("../store/StoreView"));

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
      <Match when={props.tool === "flight"}><FlightView /></Match>
      <Match when={props.tool === "doctor"}><DoctorView /></Match>
      <Match when={props.tool === "security"}><SecurityView /></Match>
      <Match when={props.tool === "docker"}><DockerView /></Match>
      <Match when={props.tool === "servers"}><ServersView /></Match>
      <Match when={props.tool === "store"}><StoreView /></Match>
    </Switch>
  );
}
