// 📸 Окно «Красивый скриншот кода».
import { createEffect, createSignal, For, Show } from "solid-js";
import { notify } from "../app/notify";
import { saveAs } from "../i18n/dialog";
import { core } from "../ipc";
import { GRADIENTS, renderSnapshot, setSnapSource, snapSource } from "./snapshot";

export default function SnapshotDialog() {
  const [gradient, setGradient] = createSignal(Number(localStorage.getItem("tulpar.snap.gradient") ?? 2));
  const [padding, setPadding] = createSignal(56);
  const [watermark, setWatermark] = createSignal(true);
  const [title, setTitle] = createSignal("");
  let canvas!: HTMLCanvasElement;

  createEffect(() => {
    if (!snapSource() || !canvas) return;
    renderSnapshot(canvas, { gradient: gradient(), padding: padding(), watermark: watermark(), title: title() });
  });

  const blob = () => new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  const copyImg = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await blob() })]);
      notify("Картинка скопирована — вставьте в Telegram или TikTok");
    } catch {
      notify("Не удалось скопировать — сохраните файлом", "error");
    }
  };
  const save = async () => {
    const path = await saveAs({ defaultPath: "code.png", filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    await core.userFileSaveBinary(path, new Uint8Array(await (await blob()).arrayBuffer()));
    notify("Скриншот сохранён");
  };

  return (
    <Show when={snapSource()}>
      <div class="tg-overlay" onClick={(e) => e.target === e.currentTarget && setSnapSource(null)}>
        <div class="tg-dialog snap-dialog" role="dialog">
          <div class="tg-head">
            <h2>📸 Красивый скриншот кода</h2>
            <button class="icon-button tg-close" onClick={() => setSnapSource(null)}>✕</button>
          </div>
          <div class="snap-preview"><canvas ref={canvas} /></div>
          <div class="snap-controls">
            <div class="snap-grads">
              <For each={GRADIENTS}>
                {(g, i) => (
                  <button
                    classList={{ on: gradient() === i() }}
                    title={g[0]}
                    style={{ background: `linear-gradient(135deg, ${g[1]}, ${g[2]})` }}
                    onClick={() => {
                      setGradient(i());
                      localStorage.setItem("tulpar.snap.gradient", String(i()));
                    }}
                  />
                )}
              </For>
            </div>
            <label>Отступ <input type="range" min={16} max={120} value={padding()} onInput={(e) => setPadding(Number(e.currentTarget.value))} /></label>
            <input placeholder="Заголовок окна (имя файла)" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
            <label class="chk"><input type="checkbox" checked={watermark()} onChange={(e) => setWatermark(e.currentTarget.checked)} /> made in Tulpar</label>
            <span class="grow" />
            <button onClick={() => void copyImg()}>Копировать</button>
            <button class="primary" onClick={() => void save()}>Сохранить PNG</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
