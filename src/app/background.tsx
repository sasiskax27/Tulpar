// Фон: картинка или видео. Два режима:
//  • «поверх» — полупрозрачный слой над окном, не мешает мыши (как раньше);
//  • «за панелями» — фон под окном, а панели становятся полупрозрачными «стеклом»
//    с размытием (прозрачность и размытие — в настройках).
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { core } from "../ipc";
import { settings, updateSetting } from "../config/store";
import { notify, notifyError } from "./notify";
import { photoThemeFromPixels, type PhotoTheme } from "./themes";

export async function setBackgroundFrom(path: string) {
  try {
    const stored = await core.backgroundImport(path);
    updateSetting("tulpar.background.image", stored);
    if (settings()["workbench.colorTheme"] === "photo") {
      notify("Фон установлен, тема подстроится под его цвета");
    } else {
      notify("Фон установлен. Прозрачность и размытие — в настройках (Ctrl+,)", "info", [
        { label: "Перекрасить Tulpar под картинку", run: () => usePhotoTheme() },
      ]);
    }
  } catch (e) {
    notifyError("Не удалось поставить фон", e);
  }
}

/** Включить тему «Из фоновой картинки» (оттенок посчитается из картинки). */
export function usePhotoTheme() {
  updateSetting("workbench.colorTheme", "photo");
  const s = settings();
  // Чтобы картинку было видно за кодом, но она не мешала читать
  if (Number(s["tulpar.background.opacity"]) < 0.12) updateSetting("tulpar.background.opacity", 0.2);
  if (!Number(s["tulpar.background.blur"])) updateSetting("tulpar.background.blur", 3);
}

const VIDEO_RE = /\.(mp4|webm|m4v)$/i;
export const isVideo = (path: string | null | undefined) => !!path && VIDEO_RE.test(path);

/** Кадр для расчёта цвета: картинка или первый кадр видео. */
async function frameOf(url: string, video: boolean): Promise<CanvasImageSource | null> {
  if (video) {
    const v = document.createElement("video");
    v.muted = true;
    v.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        v.onloadeddata = () => resolve();
        v.onerror = () => reject(new Error("video"));
      });
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await new Promise((r) => (v.onseeked = r));
    } catch {
      return null;
    }
    return v;
  }
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  return img;
}

/** Главный оттенок картинки или видео: уменьшаем до 48×48 и считаем по точкам. */
async function photoThemeOf(url: string, video: boolean): Promise<PhotoTheme | null> {
  const img = await frameOf(url, video);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 48, 48);
  return photoThemeFromPixels(ctx.getImageData(0, 0, 48, 48).data);
}

export async function chooseBackground() {
  const file = await open({
    multiple: false,
    title: "Фон: картинка или видео",
    filters: [
      { name: "Картинки и видео", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm", "m4v"] },
      { name: "Картинки", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
      { name: "Видео", extensions: ["mp4", "webm", "m4v"] },
    ],
  });
  if (typeof file === "string") await setBackgroundFrom(file);
}

export function clearBackground() {
  updateSetting("tulpar.background.image", null);
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
        if (isVideo(path)) notify("Загружаю видео для фона…");
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

  // Тема «Из фоновой картинки» следует за картинкой
  createEffect(
    on([url, () => settings()["workbench.colorTheme"]], ([u, theme]) => {
      if (!u || theme !== "photo") return;
      void photoThemeOf(u, isVideo(settings()["tulpar.background.image"])).then((t) => {
        if (!t || url() !== u) return;
        const cur = settings()["tulpar.photoTheme"];
        if (!cur || cur.hue !== t.hue || cur.sat !== t.sat || cur.light !== t.light) updateSetting("tulpar.photoTheme", t);
      });
    }),
  );

  const blur = () => Math.max(0, Number(settings()["tulpar.background.blur"]) || 0);
  const opacity = () => String(Math.min(1, Math.max(0, Number(settings()["tulpar.background.opacity"]) || 0)));
  const behind = () => settings()["tulpar.background.mode"] === "behind";

  // Режим «за панелями» включает «стекло» у панелей (CSS по data-glass)
  createEffect(() => {
    const el = document.documentElement;
    if (url() && behind()) el.dataset.glass = "on";
    else delete el.dataset.glass;
  });

  const layerStyle = () => ({
    opacity: behind() ? "1" : opacity(),
    filter: [blur() ? `blur(${blur()}px)` : "", behind() ? `brightness(${0.35 + Number(opacity()) * 0.9})` : ""].filter(Boolean).join(" ") || "none",
    // При размытии края светлеют — выносим их за пределы окна
    inset: `${-2 * blur()}px`,
  });

  const imageStyle = () => {
    const fit = settings()["tulpar.background.fit"];
    return {
      ...layerStyle(),
      "background-image": `url("${url()}")`,
      "background-size": fit === "cover" || fit === "contain" ? fit : "auto",
      "background-repeat": fit === "tile" ? "repeat" : "no-repeat",
      "background-position": "center",
    };
  };

  const videoFit = () => {
    const fit = settings()["tulpar.background.fit"];
    return fit === "contain" ? "contain" : fit === "center" ? "none" : "cover";
  };

  return (
    <Show when={url()}>
      <Show
        when={isVideo(settings()["tulpar.background.image"])}
        fallback={<div class="background-layer" classList={{ behind: behind() }} style={imageStyle()} />}
      >
        <video
          class="background-layer background-video"
          classList={{ behind: behind() }}
          style={{ ...layerStyle(), "object-fit": videoFit() }}
          src={url()!}
          autoplay
          loop
          muted
          playsinline
          // Видео не должно тратить батарею, когда окно свернуто
          ref={(v) => {
            const onVis = () => (document.hidden ? v.pause() : void v.play().catch(() => undefined));
            document.addEventListener("visibilitychange", onVis);
            onCleanup(() => document.removeEventListener("visibilitychange", onVis));
          }}
        />
      </Show>
    </Show>
  );
}
