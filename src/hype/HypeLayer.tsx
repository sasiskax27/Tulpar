// Всё «хайповое» поверх окна: плеер, скриншот, голос, комбо Power mode.
import { Show } from "solid-js";
import MusicPlayer from "./MusicPlayer";
import SnapshotDialog from "./SnapshotDialog";
import { heard, listening, toggleVoice } from "./voice";
import { comboCount, power } from "./power";

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
      <Show when={power() !== "off" && comboCount() >= 10}>
        <div class="power-combo" classList={{ hot: comboCount() >= 50 }}>
          <b>{comboCount()}</b>
          <span>КОМБО</span>
        </div>
      </Show>
    </>
  );
}
