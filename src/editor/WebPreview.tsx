// Живой предпросмотр сайта с локального dev-сервера (Vite, Next, Django…)
// прямо в правой половине редактора. Автообновление делает сам dev-сервер.
import { createSignal } from "solid-js";
import { showWeb } from "./side";

export default function WebPreview(props: { url: string }) {
  const [address, setAddress] = createSignal(props.url);
  const [key, setKey] = createSignal(0);
  let frame: HTMLIFrameElement | undefined;

  const go = () => {
    let u = address().trim();
    if (!u) return;
    if (/^\d+$/.test(u)) u = `http://localhost:${u}`;
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    setAddress(u);
    showWeb(u);
    setKey((k) => k + 1);
  };

  return (
    <div class="web-preview">
      <div class="web-bar">
        <button class="icon-button" title="Обновить" aria-label="Обновить" onClick={() => setKey((k) => k + 1)}>
          ⟳
        </button>
        <input
          class="web-address"
          value={address()}
          spellcheck={false}
          aria-label="Адрес"
          onInput={(e) => setAddress(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
      </div>
      {(() => {
        key();
        return (
          <iframe
            ref={frame}
            class="web-frame"
            src={props.url}
            title="Предпросмотр сайта"
            sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups allow-downloads"
          />
        );
      })()}
    </div>
  );
}
