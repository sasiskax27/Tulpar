// Окно с QR-кодом для телефона.
import { Show } from "solid-js";
import qrcode from "qrcode-generator";
import { phoneDialog, phoneInfo, setPhoneDialog, stopPhone } from "./phone";

function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export default function PhoneDialog() {
  return (
    <Show when={phoneDialog() && phoneInfo()}>
      {(i) => (
        <div class="tg-overlay" onClick={(e) => e.target === e.currentTarget && setPhoneDialog(false)}>
          <div class="tg-dialog phone-dialog" role="dialog" aria-label="Телефон как второй экран">
            <div class="tg-head">
              <h2>📱 Телефон — второй экран</h2>
              <button class="icon-button tg-close" title="Закрыть" aria-label="Закрыть" onClick={() => setPhoneDialog(false)}>
                ✕
              </button>
            </div>
            <div class="phone-body">
              <div class="phone-qr" innerHTML={qrSvg(i().url)} />
              <div class="phone-text">
                <ol>
                  <li>Телефон и компьютер — в одной сети Wi-Fi</li>
                  <li>Наведите камеру телефона на QR-код</li>
                  <li>На телефоне: ошибки, тесты, терминал, сайт и задачи для ИИ-агента</li>
                </ol>
                <p class="ext-note">
                  Windows может спросить разрешение для сети — нажмите «Разрешить» для частных сетей. Без ключа из QR-кода страница не откроется.
                </p>
                <code class="phone-url" data-no-translate>
                  {i().url}
                </code>
                <div class="tg-editor-buttons">
                  <button class="button-quiet" onClick={() => void navigator.clipboard.writeText(i().url)}>
                    Скопировать адрес
                  </button>
                  <button class="button-quiet db-delete" onClick={() => void stopPhone()}>
                    Выключить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
