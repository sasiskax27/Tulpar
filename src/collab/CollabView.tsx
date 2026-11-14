// 👥 Панель «Вместе по сети»: пригласить или подключиться, у гостя — редактор.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import qrcode from "qrcode-generator";
import { monaco, editorOptions } from "../editor/monaco";
import { settings } from "../config/store";
import { notify } from "../app/notify";
import { copy } from "../tools/ai";
import {
  collabMode, collabPeers, collabStatus, collabUrl, guestCursorDecorations, guestFile, guestModel, guestSaveCopy, guestVersion,
  joinSession, leave, openGuestFile, saveGuestFile, sendGuestCursor, sharedFiles, startHost, stopHost,
} from "./collab";

const NAME = "tulpar.collab.name";
const COLORS = ["#e5484d", "#30a46c", "#0090ff", "#f76b15", "#8e4ec6", "#e93d82", "#12a594", "#ffb224"];

function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function GuestEditor() {
  let host!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  onMount(() => {
    editor = monaco.editor.create(host, { ...editorOptions(settings()), model: null, automaticLayout: true });
    const decor = editor.createDecorationsCollection();
    let timer = 0;
    editor.onDidChangeCursorPosition((e) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const rel = guestFile();
        if (rel) sendGuestCursor(rel, e.position.lineNumber, e.position.column);
      }, 120);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveGuestFile());
    createEffect(
      on([guestFile, guestVersion], () => {
        const rel = guestFile();
        const model = rel ? guestModel(rel) : undefined;
        if (editor!.getModel() !== (model ?? null)) editor!.setModel(model ?? null);
        decor.set(rel ? guestCursorDecorations(rel) : []);
      }),
    );
  });
  onCleanup(() => editor?.dispose());
  return <div class="collab-editor" ref={host} />;
}

export default function CollabView() {
  const [name, setName] = createSignal(localStorage.getItem(NAME) ?? "");
  const [link, setLink] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const saveName = (v: string) => {
    setName(v);
    localStorage.setItem(NAME, v);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="tool collab">
      <Show when={collabMode() === "off"}>
        <div class="tool-row">
          <input class="tool-input" placeholder="Ваше имя для других" value={name()} onInput={(e) => saveName(e.currentTarget.value)} />
        </div>
        <div class="collab-choose">
          <div class="collab-card">
            <h3>Пригласить</h3>
            <p class="dim">Друзья в той же сети Wi-Fi увидят открытые у вас файлы и смогут править их вместе с вами — с курсорами, как в Google Docs.</p>
            <button class="primary" disabled={busy()} onClick={() => void run(() => startHost(name()))}>Начать сессию</button>
          </div>
          <div class="collab-card">
            <h3>Подключиться</h3>
            <p class="dim">Вставьте ссылку, которую показал хозяин.</p>
            <input class="tool-input" placeholder="http://192.168.…:47830/?k=…" value={link()} onInput={(e) => setLink(e.currentTarget.value)} data-no-translate />
            <button class="primary" disabled={busy() || !link().trim()} onClick={() => void run(() => joinSession(link(), name()))}>Подключиться</button>
          </div>
        </div>
        <div class="dim small">Всё идёт напрямую между компьютерами в вашей сети, без серверов в интернете. Доступ — только по секретной ссылке.</div>
      </Show>

      <Show when={collabMode() === "host"}>
        <div class="collab-host">
          <div class="collab-qr" innerHTML={qrSvg(collabUrl())} />
          <div class="collab-host-info">
            <div class="tool-sub">Ссылка для друзей</div>
            <div class="tool-row">
              <code class="collab-link" data-no-translate>{collabUrl()}</code>
              <button onClick={() => { copy(collabUrl()); notify("Ссылка скопирована"); }}>Копировать</button>
            </div>
            <div class="dim small">Делитесь только с теми, кому доверяете: по ссылке можно править открытые файлы.</div>
            <button onClick={() => void stopHost()}>Завершить сессию</button>
          </div>
        </div>
        <div class="tool-sub">Общие файлы — все открытые вкладки ({sharedFiles().length})</div>
        <div class="collab-files" data-no-translate>
          <For each={sharedFiles()} fallback={<span class="dim">Откройте файлы во вкладках — они станут общими</span>}>{(f) => <span>{f}</span>}</For>
        </div>
      </Show>

      <Show when={collabMode() === "guest"}>
        <div class="tool-row">
          <select value={guestFile() ?? ""} onChange={(e) => openGuestFile(e.currentTarget.value)} data-no-translate>
            <For each={sharedFiles()}>{(f) => <option value={f}>{f}</option>}</For>
          </select>
          <button onClick={saveGuestFile} title="Сохранить файл у хозяина (Ctrl+S)">Сохранить</button>
          <button onClick={() => void guestSaveCopy()} title="Записать копию в вашу открытую папку">Копия себе</button>
          <span class="grow" />
          <span class="dim small">{collabStatus()}</span>
          <button onClick={() => void leave()}>Отключиться</button>
        </div>
        <GuestEditor />
      </Show>

      <Show when={collabMode() !== "off"}>
        <div class="collab-peers">
          <span class="dim">В сессии:</span>
          <For each={collabPeers()} fallback={<span class="dim">пока никого — ждём подключения</span>}>
            {(p) => (
              <span class="collab-peer" style={{ "--c": COLORS[p.color % COLORS.length] }} data-no-translate>
                {p.name}
                {p.file ? ` · ${p.file.split("/").pop()}:${p.line}` : ""}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
