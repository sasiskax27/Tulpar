// 🎧 Маленький плеер в углу окна.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { open } from "../i18n/dialog";
import { notify } from "../app/notify";
import {
  PRESETS, addFiles, addTrack, current, embedFromLink, fileUrl, minimized, next, play, playerOpen, playlist, removeTrack,
  setMinimized, setPlayerOpen, stopMusic, type Track,
} from "./music";

export default function MusicPlayer() {
  const [link, setLink] = createSignal("");
  const [src, setSrc] = createSignal<string | null>(null);
  const [showList, setShowList] = createSignal(false);
  let audio: HTMLAudioElement | undefined;

  createEffect(
    on(current, async (t) => {
      setSrc(null);
      if (t?.kind === "file") {
        try {
          setSrc(await fileUrl(t));
          setTimeout(() => void audio?.play().catch(() => undefined), 50);
        } catch (e) {
          notify(String(e), "error");
        }
      }
    }),
  );

  const addLink = () => {
    const t = embedFromLink(link());
    if (!t) {
      notify("Не понял ссылку. Подходят Spotify, YouTube, SoundCloud и Яндекс Музыка", "error");
      return;
    }
    addTrack(t);
    play(t);
    setLink("");
  };

  const pickFiles = async () => {
    const r = await open({ multiple: true, filters: [{ name: "Музыка", extensions: ["mp3", "ogg", "wav", "m4a", "flac", "aac", "opus"] }] });
    const list = Array.isArray(r) ? r : r ? [r] : [];
    if (!list.length) return;
    addFiles(list);
    const first = playlist().find((t) => t.path === list[0]);
    if (first) play(first);
  };

  const embedHeight = (t: Track) => (t.kind === "spotify" ? 152 : t.kind === "youtube" ? 170 : t.kind === "yandex" ? 180 : 166);

  return (
    <Show when={playerOpen()}>
      <div class="music" classList={{ mini: minimized() }}>
        <div class="music-head">
          <span class="music-title" data-no-translate>🎧 {current()?.title ?? "Музыка"}</span>
          <button title="Список" onClick={() => setShowList(!showList())}>☰</button>
          <button title="Свернуть" onClick={() => setMinimized(!minimized())}>{minimized() ? "▴" : "▾"}</button>
          <button title="Закрыть и выключить" onClick={stopMusic}>✕</button>
        </div>
        <div class="music-body" style={{ display: minimized() ? "none" : undefined }}>
          <Show when={current()?.embed}>
            {(url) => (
              <iframe
                class="music-embed"
                src={url()}
                height={embedHeight(current()!)}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                referrerpolicy="strict-origin-when-cross-origin"
                title="music"
              />
            )}
          </Show>
          <Show when={current()?.kind === "file" && src()}>
            <div class="music-file">
              <button onClick={() => next(-1)}>⏮</button>
              <audio ref={audio} src={src()!} controls onEnded={() => next(1)} />
              <button onClick={() => next(1)}>⏭</button>
            </div>
          </Show>
          <Show when={showList() || !current()}>
            <div class="music-add">
              <input placeholder="Ссылка Spotify / YouTube / SoundCloud / Яндекс" value={link()} onInput={(e) => setLink(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} />
              <button onClick={addLink}>+</button>
              <button onClick={() => void pickFiles()} title="Свои mp3 с компьютера">📁</button>
            </div>
            <div class="music-list">
              <For each={playlist()}>
                {(t) => (
                  <div class="music-item" classList={{ on: current() === t }}>
                    <button class="music-play" onClick={() => play(t)}>{t.kind === "file" ? "🎵" : t.kind === "spotify" ? "🟢" : t.kind === "youtube" ? "▶️" : "☁️"} {t.title}</button>
                    <button onClick={() => removeTrack(t)}>×</button>
                  </div>
                )}
              </For>
              <div class="music-sub">Подборки</div>
              <For each={PRESETS}>{(t) => <button class="music-play" onClick={() => play(t)}>✨ {t.title}</button>}</For>
            </div>
            <div class="music-note">Spotify без входа играет 30-секундные отрывки — войдите в аккаунт прямо в плеере, чтобы слушать целиком.</div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

export const openMusic = () => setPlayerOpen(true);
