import { createEffect, For, onMount, Show } from "solid-js";
import Layout from "./Layout";
import Palette from "../palette/Palette";
import InputBox from "./InputBox";
import BackgroundLayer from "./background";
import SettingsView from "../settings/SettingsView";
import AiOverlay from "../ai/AiOverlay";
import ContextMenu from "./ContextMenu";
import QuickPick from "./QuickPick";
import Onboarding, { maybeShowOnboarding } from "./Onboarding";
import ThemeGallery from "./ThemeGallery";
import VideoStudio from "../video/VideoStudio";
import { notices, dismiss } from "./notify";
import { settings } from "../config/store";
import { cssVars, isLightTheme } from "./themes";

const clamp = (v: number, min: number, max: number, def: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;

export default function App() {
  // Тема и стиль интерфейса следуют настройкам workbench.*
  let applied: string[] = [];
  createEffect(() => {
    const s = settings();
    const el = document.documentElement;
    const wanted = String(s["workbench.colorTheme"] ?? "steppe");
    // Тема из расширения ещё не загрузилась или удалена — показываем «Ночную степь»
    const theme = wanted === "dark" || wanted === "light" || cssVars(wanted) ? wanted : "steppe";
    el.dataset.theme = theme;
    el.dataset.tone = isLightTheme(theme) ? "light" : "dark";
    el.dataset.style = s["workbench.style"] === "tulpar" ? "tulpar" : "classic";
    el.dataset.islands = s["workbench.islands"] || s["workbench.style"] === "tulpar" ? "on" : "off";
    el.dataset.tabs = String(s["workbench.tabs.style"] ?? "pills");
    for (const name of applied) el.style.removeProperty(name);
    const vars: Record<string, string> = {
      ...(cssVars(theme) ?? {}),
      "--tp-radius": `${clamp(Number(s["workbench.radius"]), 0, 20, 10)}px`,
      "--tp-font-size-ui": `${clamp(Number(s["workbench.uiFontSize"]), 10, 18, 13)}px`,
      "--tp-gap": `${clamp(Number(s["workbench.gap"]), 0, 16, 6)}px`,
      "--tp-panel-alpha": `${Math.round(clamp(Number(s["workbench.panelOpacity"]), 0.3, 1, 0.78) * 100)}%`,
      "--tp-panel-blur": `${clamp(Number(s["workbench.panelBlur"]), 0, 40, 14)}px`,
    };
    for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
    applied = Object.keys(vars);
  });

  onMount(() => {
    document.body.classList.add("ready");
    // Мастер — чуть позже, когда загрузятся настройки
    setTimeout(maybeShowOnboarding, 600);
  });

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
      <Onboarding />
      <ThemeGallery />
      <VideoStudio />
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
