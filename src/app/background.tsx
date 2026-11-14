// Фоновая картинка. Рисуется полупрозрачным слоем поверх окна и не мешает мыши —
// так она видна и в редакторе, и в панелях, и не требует менять темы.
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

/** Главный оттенок картинки: уменьшаем до 48×48 и считаем по точкам. */
async function photoThemeOf(url: string): Promise<PhotoTheme | null> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
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
    title: "Фоновая картинка",
    filters: [{ name: "Картинки", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
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
      void photoThemeOf(u).then((t) => {
        if (!t || url() !== u) return;
        const cur = settings()["tulpar.photoTheme"];
        if (!cur || cur.hue !== t.hue || cur.sat !== t.sat || cur.light !== t.light) updateSetting("tulpar.photoTheme", t);
      });
    }),
  );

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
