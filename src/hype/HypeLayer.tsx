// Всё «хайповое» поверх окна: плеер, скриншот, голос, комбо Power mode.
import { lazy, Show } from "solid-js";
import { playerOpen } from "./music";
import { snapSource } from "./snapshot";

// Плеер и окно скриншота грузятся только при первом открытии
const MusicPlayer = lazy(() => import("./MusicPlayer"));
const SnapshotDialog = lazy(() => import("./SnapshotDialog"));
import { heard, listening, toggleVoice } from "./voice";
import { comboCount, power } from "./power";
import { settings } from "../config/store";

export default function HypeLayer() {
  return (
    <>
      <Show when={playerOpen()}><MusicPlayer /></Show>
      <Show when={snapSource()}><SnapshotDialog /></Show>
      <Show when={listening()}>
        <div class="voice-overlay" onClick={() => toggleVoice()}>
          <span class="voice-dot" />
          <span>{heard() || "Говорите… (клик — стоп)"}</span>
        </div>
      </Show>
      <Show when={power() !== "off" && settings()["tulpar.fun.combo"] && comboCount() >= 10}>
        <div class="power-combo" classList={{ hot: comboCount() >= 50 }}>
          <b>{comboCount()}</b>
          <span>КОМБО</span>
        </div>
      </Show>
    </>
  );
}
