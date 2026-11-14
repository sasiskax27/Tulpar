// Фоновая картинка. Рисуется полупрозрачным слоем поверх окна и не мешает мыши —
// так она видна и в редакторе, и в панелях, и не требует менять темы.
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { core } from "../ipc";
import { settings, updateSetting } from "../config/store";
import { notify, notifyError } from "./notify";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

export async function setBackgroundFrom(path: string) {
  try {
    const stored = await core.backgroundImport(path);
    updateSetting("tulpar.background.image", stored);
    notify("Фон установлен. Прозрачность и размытие — в настройках (Ctrl+,)");
  } catch (e) {
    notifyError("Не удалось поставить фон", e);
  }
}

export async function chooseBackground() {
  const file = await open({
    multiple: false,
    title: "Фоновая картинка",
    filters: [{ name: "Картинки", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
  });
  if (typeof file === "string") await setBackgroundFrom(file);
}

export function clearBackground() {
  updateSetting("tulpar.background.image", null);
}

/** Картинка, брошенная в окно Tulpar, становится фоном. */
export async function initDragDrop() {
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const image = event.payload.paths.find((p) => IMAGE_RE.test(p));
      if (image) void setBackgroundFrom(image);
    });
  } catch (e) {
    console.warn("Перетаскивание файлов недоступно", e);
  }
}

function toBlobUrl(mime: string, base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export default function BackgroundLayer() {
  const [url, setUrl] = createSignal<string | null>(null);
  let generation = 0;

  const replaceUrl = (next: string | null) => {
    const prev = url();
    setUrl(next);
    if (prev) URL.revokeObjectURL(prev);
  };

  createEffect(
    on(
      () => settings()["tulpar.background.image"],
      (path) => {
        const mine = ++generation;
        if (!path) {
          replaceUrl(null);
          return;
        }
        core
          .imageRead(path)
          .then((img) => {
            if (mine === generation) replaceUrl(toBlobUrl(img.mime, img.base64));
          })
          .catch((e) => {
            if (mine !== generation) return;
            replaceUrl(null);
            notifyError("Фоновая картинка", e);
          });
      },
    ),
  );
  onCleanup(() => replaceUrl(null));

  const style = () => {
    const s = settings();
    const fit = s["tulpar.background.fit"];
    const blur = Math.max(0, Number(s["tulpar.background.blur"]) || 0);
    return {
      "background-image": `url("${url()}")`,
      "background-size": fit === "cover" || fit === "contain" ? fit : "auto",
      "background-repeat": fit === "tile" ? "repeat" : "no-repeat",
      "background-position": "center",
      opacity: String(Math.min(1, Math.max(0, Number(s["tulpar.background.opacity"]) || 0))),
      filter: blur ? `blur(${blur}px)` : "none",
      // При размытии края светлеют — выносим их за пределы окна
      inset: `${-2 * blur}px`,
    };
  };

  return (
    <Show when={url()}>
      <div class="background-layer" style={style()} />
    </Show>
  );
}
