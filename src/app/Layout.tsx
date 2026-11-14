// Раскладка окна. Два дизайна: classic (Дизайн 1) и tulpar (Дизайн 2).
// Не зашита в код: какие панели в каком слоте — берётся из layout.json.
//  ┌────┬─────────┬──────────────────┬─────────┐
//  │ AB │  left   │      center      │  right  │
//  │    │         ├──────────────────┤         │
//  │    │         │      bottom      │         │
//  ├────┴─────────┴──────────────────┴─────────┤
//  │                status bar                 │
//  └───────────────────────────────────────────┘
import { createSignal, For, onCleanup, Show } from "solid-js";
import { bottomVisible, setSidebarVisible, sidebarVisible } from "./ui";
import { Dynamic } from "solid-js/web";
import { activeLayout, layoutConfig, settings, updateSetting, type Slot } from "../config/store";
import { panels, UnknownPanel } from "./panels";
import ActivityBar from "./ActivityBar";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";
import { ViewSwitcher } from "./views";

const [leftWidth, setLeftWidth] = createSignal(260);
const [rightWidth, setRightWidth] = createSignal(360);
const [bottomHeight, setBottomHeight] = createSignal(240);

function slotPanels(slot: Slot): string[] {
  const layout = layoutConfig().layouts[activeLayout()] ?? {};
  const list = layout[slot] ?? [];
  // Терминал должен открываться по Ctrl+` в любой раскладке, даже если
  // в layout.json его нет: тогда он появляется внизу.
  if (slot === "bottom" && !Object.values(layout).some((ids) => ids?.includes("terminal"))) {
    return [...list, "terminal"];
  }
  return list;
}

function SlotView(props: { slot: Slot }) {
  return (
    <For each={slotPanels(props.slot)}>
      {(id) => (
        <div class="slot-panel">
          <Show when={panels[id]} fallback={<UnknownPanel id={id} />}>
            <Dynamic component={panels[id]} />
          </Show>
        </div>
      )}
    </For>
  );
}

/** Ручка для изменения размера панели мышью. */
function Sash(props: { axis: "x" | "y"; get: () => number; set: (v: number) => void; invert?: boolean }) {
  const start = (e: PointerEvent) => {
    e.preventDefault();
    const origin = props.axis === "x" ? e.clientX : e.clientY;
    const initial = props.get();
    const move = (ev: PointerEvent) => {
      const delta = (props.axis === "x" ? ev.clientX : ev.clientY) - origin;
      props.set(Math.max(120, Math.min(900, initial + (props.invert ? -delta : delta))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return <div class={`sash sash-${props.axis}`} onPointerDown={start} />;
}

function ClassicLayout() {
  const bar = () => settings()["workbench.activityBar"] ?? "left";
  const hasLeft = () => sidebarVisible() && slotPanels("left").length > 0;
  const hasRight = () => slotPanels("right").length > 0;
  const hasBottom = () => bottomVisible() && slotPanels("bottom").length > 0;

  return (
    <div class="workbench" data-bar={bar()}>
      <div class="workbench-main">
        <Show when={bar() === "left"}>
          <ActivityBar />
        </Show>
        <Show when={hasLeft()}>
          <aside class="slot slot-left" style={{ width: `${leftWidth()}px` }}>
            <Show when={bar() === "hidden"}>
              <ViewSwitcher />
            </Show>
            <SlotView slot="left" />
          </aside>
          <Sash axis="x" get={leftWidth} set={setLeftWidth} />
        </Show>
        <CenterColumn hasBottom={hasBottom()} />
        <Show when={hasRight()}>
          <Sash axis="x" get={rightWidth} set={setRightWidth} invert />
          <aside class="slot slot-right" style={{ width: `${rightWidth()}px` }}>
            <SlotView slot="right" />
          </aside>
        </Show>
        <Show when={bar() === "right"}>
          <ActivityBar />
        </Show>
      </div>
      <Show when={settings()["workbench.statusBar.visible"] !== false}>
        <StatusBar />
      </Show>
    </div>
  );
}

function CenterColumn(props: { hasBottom: boolean }) {
  return (
    <main class="slot-center-column">
      <section class="slot slot-center">
        <SlotView slot="center" />
      </section>
      <Show when={props.hasBottom}>
        <Sash axis="y" get={bottomHeight} set={setBottomHeight} invert />
        <section class="slot slot-bottom" style={{ height: `${bottomHeight()}px` }}>
          <SlotView slot="bottom" />
        </section>
      </Show>
    </main>
  );
}

/**
 * Дизайн 2: верхняя панель с ИИ-островом, без полосы иконок.
 * Боковой остров выезжает при наведении на левый край (или по команде)
 * и раздвигает код; при workbench.sidebar.autoHide = false он закреплён.
 */
function TulparLayout() {
  const autoHide = () => settings()["workbench.sidebar.autoHide"] !== false;
  const open = () => sidebarVisible() && slotPanels("left").length > 0;
  const hasRight = () => slotPanels("right").length > 0;
  const hasBottom = () => bottomVisible() && slotPanels("bottom").length > 0;

  let aside: HTMLElement | undefined;
  let closeTimer: number | undefined;
  const cancelClose = () => window.clearTimeout(closeTimer);
  const scheduleClose = () => {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      if (aside?.contains(document.activeElement) || aside?.matches(":hover")) return;
      if (document.body.classList.contains("resizing")) return;
      setSidebarVisible(false);
    }, 450);
  };
  onCleanup(cancelClose);

  return (
    <div class="workbench">
      <TopBar />
      <div class="workbench-main">
        <Show when={autoHide() && !open()}>
          <div
            class="edge-zone"
            onMouseEnter={() => setSidebarVisible(true)}
          />
        </Show>
        <aside
          ref={aside}
          class="slot slot-left side-island"
          classList={{ open: open() }}
          style={{ width: open() ? `${leftWidth()}px` : "0px" }}
          aria-hidden={!open()}
          onMouseEnter={cancelClose}
          onMouseLeave={() => autoHide() && scheduleClose()}
          onFocusOut={() => autoHide() && scheduleClose()}
        >
          <div class="side-inner" style={{ width: `${leftWidth()}px` }}>
            <div class="side-head">
              <ViewSwitcher />
              <button
                class="icon-button side-pin"
                classList={{ active: !autoHide() }}
                title={autoHide() ? "Закрепить панель" : "Прятать панель автоматически"}
                onClick={() => updateSetting("workbench.sidebar.autoHide", !autoHide())}
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6zM8 8.5V14" /></svg>
              </button>
            </div>
            <SlotView slot="left" />
          </div>
        </aside>
        <Show when={open()}>
          <Sash axis="x" get={leftWidth} set={setLeftWidth} />
        </Show>
        <CenterColumn hasBottom={hasBottom()} />
        <Show when={hasRight()}>
          <Sash axis="x" get={rightWidth} set={setRightWidth} invert />
          <aside class="slot slot-right" style={{ width: `${rightWidth()}px` }}>
            <SlotView slot="right" />
          </aside>
        </Show>
      </div>
      <Show when={settings()["workbench.statusBar.visible"] !== false}>
        <StatusBar />
      </Show>
    </div>
  );
}

export default function Layout() {
  return (
    <Show when={settings()["workbench.style"] === "tulpar"} fallback={<ClassicLayout />}>
      <TulparLayout />
    </Show>
  );
}
