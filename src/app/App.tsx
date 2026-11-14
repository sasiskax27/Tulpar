import { createEffect, For, onMount, Show } from "solid-js";
import Layout from "./Layout";
import Palette from "../palette/Palette";
import InputBox from "./InputBox";
import BackgroundLayer from "./background";
import SettingsView from "../settings/SettingsView";
import AiOverlay from "../ai/AiOverlay";
import ContextMenu from "./ContextMenu";
import QuickPick from "./QuickPick";
import { notices, dismiss } from "./notify";
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
      <ContextMenu />
      <QuickPick />
      <div class="notices">
        <For each={notices()}>
          {(n) => (
            <div class={`notice notice-${n.level}`} role="status">
              <div>{n.text}</div>
              <Show when={n.actions?.length}>
                <div class="notice-actions">
                  <For each={n.actions}>
                    {(a) => (
                      <button
                        class="button-quiet"
                        onClick={() => {
                          dismiss(n.id);
                          a.run();
                        }}
                      >
                        {a.label}
                      </button>
                    )}
                  </For>
                  <button class="button-quiet" onClick={() => dismiss(n.id)}>Закрыть</button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
