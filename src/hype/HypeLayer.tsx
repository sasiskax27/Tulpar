// Всё «хайповое» поверх окна: плеер, скриншот, голос, комбо Power mode.
import { Show } from "solid-js";
import MusicPlayer from "./MusicPlayer";
import SnapshotDialog from "./SnapshotDialog";
import { heard, listening, toggleVoice } from "./voice";
import { comboCount, power } from "./power";
import { settings } from "../config/store";

export default function HypeLayer() {
  return (
    <>
      <MusicPlayer />
      <SnapshotDialog />
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
