// Окно «Код в видео»: настройка ролика, запись и сохранение.
import { createSignal, onCleanup, Show } from "solid-js";
import { lastRecording, recording, startRecording, startedAt, stopRecording } from "./recorder";
import { bestMime, renderVideo, Player, buildSteps, drawFrame, type VideoOptions } from "./render";
import { core } from "../ipc";
import { saveAs } from "../i18n/dialog";
import { notify, notifyError } from "../app/notify";

const [open, setOpen] = createSignal(false);
export const showVideoStudio = () => setOpen(true);

/** Кнопка в строке состояния: запись идёт — красная точка и таймер. */
export function RecordingBadge() {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));
  const elapsed = () => {
    const s = Math.max(0, Math.floor((now() - startedAt()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return (
    <Show when={recording()}>
      <button
        class="status-item rec-badge"
        title="Остановить запись и сделать видео"
        onClick={() => {
          if (stopRecording()) setOpen(true);
        }}
      >
        <span class="rec-dot" /> {elapsed()} · Стоп
      </button>
    </Show>
  );
}

export default function VideoStudio() {
  const [title, setTitle] = createSignal("Сделал это за 5 минут 🔥");
  const [seconds, setSeconds] = createSignal(30);
  const [vertical, setVertical] = createSignal(true);
  const [watermark, setWatermark] = createSignal(true);
  const [progress, setProgress] = createSignal<number | null>(null);
  let canvas!: HTMLCanvasElement;
  const signal = { cancelled: false };

  const opts = (): VideoOptions => ({ title: title(), seconds: seconds(), vertical: vertical(), showWatermark: watermark() });

  /** Статичный предпросмотр: как будет выглядеть середина ролика. */
  const preview = () => {
    const rec = lastRecording();
    if (!rec || !canvas) return;
    canvas.width = vertical() ? 1080 : 1920;
    canvas.height = vertical() ? 1920 : 1080;
    const player = new Player(rec, buildSteps(rec, 600));
    player.advanceTo(0.6);
    drawFrame(canvas.getContext("2d")!, player, opts(), true);
  };

  const make = async () => {
    const rec = lastRecording();
    if (!rec) return;
    signal.cancelled = false;
    setProgress(0);
    try {
      const out = await renderVideo(canvas, rec, opts(), setProgress, signal);
      if (!out) return;
      const ext = out.mime.includes("mp4") ? "mp4" : "webm";
      const path = await saveAs({
        title: "Сохранить видео",
        defaultPath: `tulpar-${new Date().toISOString().slice(0, 10)}.${ext}`,
        filters: [{ name: "Видео", extensions: [ext] }],
      });
      if (!path) return;
      await core.userFileSaveBinary(path, new Uint8Array(await out.blob.arrayBuffer()));
      notify(
        ext === "mp4"
          ? `Видео сохранено: ${path}. Можно сразу загружать в ТикТок 🎉`
          : `Видео сохранено: ${path}. Это WebM — ТикТок его не берёт, переведите в MP4 (например, через CapCut).`,
      );
    } catch (e) {
      notifyError("Не удалось сделать видео", e);
    } finally {
      setProgress(null);
    }
  };

  return (
    <Show when={open()}>
      <div class="tg-overlay" onClick={(e) => e.target === e.currentTarget && progress() === null && setOpen(false)}>
        <div class="tg-dialog vs-dialog" role="dialog" aria-label="Код в видео">
          <div class="tg-head">
            <h2>🎬 Код в видео</h2>
            <button class="icon-button tg-close" title="Закрыть" aria-label="Закрыть" disabled={progress() !== null} onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <Show
            when={lastRecording()}
            fallback={
              <div class="vs-empty">
                <p>
                  Tulpar запишет, как вы пишете код, и сделает из этого ролик: код будет печататься сам в вашей теме — для ТикТока, Reels или
                  Shorts.
                </p>
                <ol>
                  <li>Нажмите «Начать запись»</li>
                  <li>Пишите код как обычно (можно и с ИИ-агентом)</li>
                  <li>Нажмите «Стоп» внизу справа — откроется это окно</li>
                </ol>
                <button
                  class="button"
                  disabled={recording()}
                  onClick={() => {
                    startRecording();
                    setOpen(false);
                  }}
                >
                  {recording() ? "● Идёт запись" : "● Начать запись"}
                </button>
              </div>
            }
          >
            <div class="vs-body">
              <div class="vs-preview" classList={{ horizontal: !vertical() }}>
                <canvas ref={(el) => ((canvas = el), queueMicrotask(preview))} />
                <Show when={progress() !== null}>
                  <div class="vs-progress">
                    <div style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} />
                    <span>Записываю видео… {Math.round((progress() ?? 0) * 100)}%</span>
                  </div>
                </Show>
              </div>
              <div class="vs-controls">
                <label class="tg-field">
                  <span>Заголовок сверху</span>
                  <input class="tg-name" value={title()} onInput={(e) => (setTitle(e.currentTarget.value), preview())} />
                </label>
                <label class="tg-field">
                  <span>Длина ролика: {seconds()} с</span>
                  <input type="range" min="10" max="90" step="5" value={seconds()} onInput={(e) => setSeconds(Number(e.currentTarget.value))} />
                </label>
                <div class="db-kinds">
                  <button classList={{ on: vertical() }} onClick={() => (setVertical(true), preview())}>
                    9:16 — ТикТок
                  </button>
                  <button classList={{ on: !vertical() }} onClick={() => (setVertical(false), preview())}>
                    16:9 — YouTube
                  </button>
                </div>
                <label class="tg-color">
                  <input type="checkbox" checked={watermark()} onChange={(e) => (setWatermark(e.currentTarget.checked), preview())} />
                  <span>Подпись «сделано в Tulpar»</span>
                </label>
                <p class="ext-note">
                  Цвета — из текущей темы. Видео пишется в реальном времени, так что ролик на {seconds()} с займёт {seconds()} с.{" "}
                  {bestMime().includes("mp4") ? "Формат MP4." : "Формат WebM."}
                </p>
                <div class="tg-editor-buttons">
                  <Show
                    when={progress() === null}
                    fallback={
                      <button class="button-quiet" onClick={() => (signal.cancelled = true)}>
                        Отменить
                      </button>
                    }
                  >
                    <button class="button" onClick={() => void make()}>
                      🎬 Сделать видео
                    </button>
                    <button
                      class="button-quiet"
                      onClick={() => {
                        startRecording();
                        setOpen(false);
                      }}
                    >
                      Записать заново
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
