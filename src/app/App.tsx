import { createEffect, For, onMount } from "solid-js";
import Layout from "./Layout";
import Palette from "../palette/Palette";
import InputBox from "./InputBox";
import BackgroundLayer from "./background";
import SettingsView from "../settings/SettingsView";
import AiOverlay from "../ai/AiOverlay";
import { notices } from "./notify";
import { settings } from "../config/store";

export default function App() {
  // Тема интерфейса следует настройке workbench.colorTheme
  createEffect(() => {
    document.documentElement.dataset.theme = settings()["workbench.colorTheme"] === "light" ? "light" : "dark";
  });

  onMount(() => document.body.classList.add("ready"));

  return (
    <>
      <Layout />
      <BackgroundLayer />
      <SettingsView />
      <Palette />
      <InputBox />
      <AiOverlay />
      <div class="notices">
        <For each={notices()}>{(n) => <div class={`notice notice-${n.level}`}>{n.text}</div>}</For>
      </div>
    </>
  );
}
