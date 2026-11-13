// Раскладка окна. Не зашита в код: какие панели в каком слоте — берётся из layout.json.
//  ┌────┬─────────┬──────────────────┬─────────┐
//  │ AB │  left   │      center      │  right  │
//  │    │         ├──────────────────┤         │
//  │    │         │      bottom      │         │
//  ├────┴─────────┴──────────────────┴─────────┤
//  │                status bar                 │
//  └───────────────────────────────────────────┘
import { createSignal, For, Show } from "solid-js";
import { sidebarVisible } from "./ui";
import { Dynamic } from "solid-js/web";
import { activeLayout, layoutConfig, type Slot } from "../config/store";
import { panels, UnknownPanel } from "./panels";
import ActivityBar from "./ActivityBar";
import StatusBar from "./StatusBar";

const [leftWidth, setLeftWidth] = createSignal(260);
const [rightWidth, setRightWidth] = createSignal(360);
const [bottomHeight, setBottomHeight] = createSignal(240);

function slotPanels(slot: Slot): string[] {
  return layoutConfig().layouts[activeLayout()]?.[slot] ?? [];
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

export default function Layout() {
  const hasLeft = () => sidebarVisible() && slotPanels("left").length > 0;
  const hasRight = () => slotPanels("right").length > 0;
  const hasBottom = () => slotPanels("bottom").length > 0;

  return (
    <div class="workbench">
      <div class="workbench-main">
        <ActivityBar />
        <Show when={hasLeft()}>
          <aside class="slot slot-left" style={{ width: `${leftWidth()}px` }}>
            <SlotView slot="left" />
          </aside>
          <Sash axis="x" get={leftWidth} set={setLeftWidth} />
        </Show>
        <main class="slot-center-column">
          <section class="slot slot-center">
            <SlotView slot="center" />
          </section>
          <Show when={hasBottom()}>
            <Sash axis="y" get={bottomHeight} set={setBottomHeight} invert />
            <section class="slot slot-bottom" style={{ height: `${bottomHeight()}px` }}>
              <SlotView slot="bottom" />
            </section>
          </Show>
        </main>
        <Show when={hasRight()}>
          <Sash axis="x" get={rightWidth} set={setRightWidth} invert />
          <aside class="slot slot-right" style={{ width: `${rightWidth()}px` }}>
            <SlotView slot="right" />
          </aside>
        </Show>
      </div>
      <StatusBar />
    </div>
  );
}
