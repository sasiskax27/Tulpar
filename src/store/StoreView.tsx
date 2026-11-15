// 🏪 Магазин Tulpar.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import qrcode from "qrcode-generator";
import { core, type WebInfo } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { askInput } from "../app/InputBox";
import { copy } from "../tools/ai";
import { runtimeProgress } from "../runtimes/runtimes";
import { servers } from "../servers/servers";
import { ITEMS, refreshPinned, type Category, type StoreItem } from "./catalog";
import { busy, install, installed, refreshInstalled, refreshRunning, running, start, stop, systemHas, uninstall } from "./actions";
import { RECIPES, runRecipe, type Recipe } from "./remote";
import { mapDrive, openShare, shareFolder, unshareFolder } from "./network";
import { OS } from "./platform";
import StoreAi from "./StoreAi";

type Tab = Category | "ai" | "remote" | "network";
const TABS: [Tab, string][] = [["ai", "✨ ИИ"], ["lang", "🧑‍💻 Языки"], ["server", "🗄 Серверы и базы"], ["tool", "🧰 Инструменты"], ["remote", "🖥 На сервер"], ["network", "📡 Сеть"]];

function qr(text: string) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
}

function Card(props: { item: StoreItem; onChange: () => void }) {
  const it = props.item;
  const prog = () => runtimeProgress()[it.id];
  const state = () => (installed()[it.id] ? "tulpar" : systemHas()[it.id] ? "system" : "none");
  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    props.onChange();
  };
  return (
    <div class="store-card" classList={{ on: state() !== "none" }}>
      <div class="store-top">
        <span class="store-icon">{it.icon}</span>
        <div class="store-name">
          <b>{it.title}</b>
          <span class="dim small">
            {state() === "tulpar" ? `в Tulpar · ${installed()[it.id]}` : state() === "system" ? "уже есть в системе" : OS === "windows" ? "портативная версия" : OS === "mac" ? "через brew" : "через менеджер пакетов"}
          </span>
        </div>
        <Show when={it.service && running()[it.id]}><span class="store-live">● работает</span></Show>
      </div>
      <div class="small store-desc">{it.desc}</div>
      <Show when={prog()}>
        {(p) => <div class="review-progress"><div class="fill" style={{ width: `${p().total ? (p().done / p().total) * 100 : 15}%` }} /><span>{p().stage === "extract" ? "распаковка…" : "скачивание…"}</span></div>}
      </Show>
      <div class="tool-row">
        <Show when={state() === "none"}>
          <button class="primary" disabled={!!busy()[it.id]} onClick={() => void act(() => install(it))}>{busy()[it.id] ? "Ставлю…" : "Установить"}</button>
        </Show>
        <Show when={it.service && state() !== "none"}>
          <Show when={running()[it.id]} fallback={<button class="primary" disabled={!!busy()[it.id]} onClick={() => void act(() => start(it))}>▶ Запустить</button>}>
            <button onClick={() => void act(() => stop(it))}>■ Остановить</button>
            <Show when={it.service!.url}><button onClick={() => void core.openUrl(it.service!.url!)}>Открыть</button></Show>
            <Show when={it.service!.conn}><button title={it.service!.conn} onClick={() => { copy(it.service!.conn!); notify("Строка подключения скопирована"); }}>Скопировать адрес</button></Show>
            <button onClick={() => void core.serviceLogs(it.id).then((t) => notify(t.split("\n").slice(-6).join("\n") || "журнал пуст"))}>Журнал</button>
          </Show>
        </Show>
        <Show when={state() === "tulpar"}>
          <span class="grow" />
          <button class="link small" onClick={() => void act(() => uninstall(it))}>Удалить</button>
        </Show>
      </div>
    </div>
  );
}

function RemoteTab() {
  const [srv, setSrv] = createSignal(servers()[0]?.id ?? "");
  const [open, setOpen] = createSignal<Recipe | null>(null);
  const [values, setValues] = createSignal<Record<string, string>>({});
  const run = async () => {
    const s = servers().find((x) => x.id === srv());
    const r = open();
    if (!s || !r) return;
    const missing = (r.fields ?? []).find((f) => !f.optional && !values()[f.key]?.trim());
    if (missing) {
      notify(`Заполните: ${missing.label}`, "error");
      return;
    }
    try {
      await runRecipe(s, r, values());
      notify("Установка идёт в терминале — там же попросит пароль sudo");
      setOpen(null);
    } catch (e) {
      notify(`${(e as Error).message}. Сначала подключите ключ: Серверы → 🔑`, "error");
    }
  };
  return (
    <Show when={servers().length} fallback={<div class="tool-empty">Сначала добавьте сервер: палитра команд → «Серверы».<br /><button class="primary" onClick={() => void import("../editor/side").then((m) => m.showTool("servers"))}>🖥 Серверы</button></div>}>
      <div class="tool-row">
        <span>На какой сервер:</span>
        <select value={srv()} onChange={(e) => setSrv(e.currentTarget.value)} data-no-translate>
          <For each={servers()}>{(s) => <option value={s.id}>{s.name} ({s.host})</option>}</For>
        </select>
      </div>
      <Show when={open()}>
        {(r) => (
          <div class="srv-form">
            <b>{r().icon} {r().title}</b>
            <div class="srv-grid">
              <For each={r().fields ?? []}>
                {(f) => (
                  <label class="srv-field">
                    <span>{f.label}</span>
                    <input placeholder={f.placeholder} value={values()[f.key] ?? ""} onInput={(e) => setValues({ ...values(), [f.key]: e.currentTarget.value })} data-no-translate />
                  </label>
                )}
              </For>
            </div>
            <div class="tool-row">
              <button class="primary" onClick={() => void run()}>Установить на сервер</button>
              <button onClick={() => setOpen(null)}>Отмена</button>
            </div>
          </div>
        )}
      </Show>
      <div class="store-grid">
        <For each={RECIPES}>
          {(r) => (
            <div class="store-card">
              <div class="store-top"><span class="store-icon">{r.icon}</span><div class="store-name"><b>{r.title}</b><span class="dim small">Ubuntu, Debian, Fedora, Arch — сам определит</span></div></div>
              <div class="small store-desc">{r.desc}</div>
              <div class="tool-row"><button class="primary" onClick={() => { setValues({}); if (r.fields?.length) setOpen(r); else { setOpen(r); void run(); } }}>Установить</button></div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function NetworkTab() {
  const [web, setWeb] = createSignal<WebInfo | null>(null);
  const [share, setShare] = createSignal("");
  onMount(() => void core.webserverStatus().then(setWeb));
  const startWeb = async () => {
    const r = root();
    if (!r) {
      notify("Откройте папку сайта");
      return;
    }
    try {
      setWeb(await core.webserverStart(r));
    } catch (e) {
      notify(String(e), "error");
    }
  };
  return (
    <div class="store-grid wide">
      <div class="store-card on">
        <div class="store-top"><span class="store-icon">🌐</span><div class="store-name"><b>Встроенный веб-сервер</b><span class="dim small">встроен в Tulpar — ничего качать не нужно</span></div><Show when={web()}><span class="store-live">● работает</span></Show></div>
        <div class="small store-desc">Раздаёт папку проекта: откройте сайт на компьютере или на телефоне в той же Wi-Fi.</div>
        <Show when={web()} fallback={<div class="tool-row"><button class="primary" onClick={() => void startWeb()}>▶ Запустить сайт</button></div>}>
          {(w) => (
            <div class="web-live">
              <div class="web-qr" innerHTML={qr(w().lan)} />
              <div>
                <div><a href="#" onClick={(e) => { e.preventDefault(); void core.openUrl(w().local); }} data-no-translate>{w().local}</a></div>
                <div class="dim small">С телефона:</div>
                <div><code data-no-translate>{w().lan}</code></div>
                <div class="tool-row">
                  <button onClick={() => void core.webserverStop().then(() => setWeb(null))}>■ Остановить</button>
                  <button onClick={() => { copy(w().lan); notify("Ссылка скопирована"); }}>Копировать</button>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
      <div class="store-card">
        <div class="store-top"><span class="store-icon">📂</span><div class="store-name"><b>Общая папка (SMB / Samba)</b><span class="dim small">{OS === "windows" ? "встроено в Windows" : OS === "mac" ? "встроено в macOS" : "через samba"}</span></div></div>
        <div class="small store-desc">Открыть папку проекта по сети — её увидят другие компьютеры. Или подключить общую папку с сервера/другого ПК.</div>
        <div class="tool-row">
          <button onClick={() => root() ? void askInput({ title: "Имя папки в сети", placeholder: "Tulpar" }).then((n) => n !== undefined && shareFolder(root()!, n || "Tulpar")) : notify("Откройте папку проекта")}>Открыть проект по сети</button>
          <button class="link small" onClick={() => void askInput({ title: "Какую общую папку закрыть?", placeholder: "Tulpar" }).then((n) => n && unshareFolder(n))}>Закрыть доступ</button>
        </div>
        <div class="tool-row">
          <input class="tool-input grow" placeholder={OS === "windows" ? "\\\\192.168.1.10\\projects" : "smb://192.168.1.10/projects"} value={share()} onInput={(e) => setShare(e.currentTarget.value)} data-no-translate />
          <button disabled={!share().trim()} onClick={() => void openShare(share())}>Открыть</button>
          <Show when={OS === "windows"}><button disabled={!share().trim()} onClick={() => void mapDrive(share())}>Как диск Z:</button></Show>
        </div>
        <div class="dim small">Поставить Samba на Linux-сервер — во вкладке «🖥 На сервер».</div>
      </div>
    </div>
  );
}

export default function StoreView() {
  const [tab, setTab] = createSignal<Tab>("ai");
  const [q, setQ] = createSignal("");
  const refresh = () => {
    void refreshInstalled(ITEMS);
    void refreshRunning();
  };
  onMount(() => {
    void refreshPinned();
    refresh();
  });
  const timer = setInterval(() => void refreshRunning(), 3000);
  onCleanup(() => clearInterval(timer));
  // Поиск ищет сразу во всех разделах
  const shown = () => {
    const needle = q().trim().toLowerCase();
    return ITEMS.filter((i) => (needle ? (i.title + " " + i.desc).toLowerCase().includes(needle) : i.category === tab()));
  };
  const installedCount = () => ITEMS.filter((i) => installed()[i.id] || systemHas()[i.id]).length;
  const catalogTab = () => !!q().trim() || (tab() !== "remote" && tab() !== "network" && tab() !== "ai");

  return (
    <div class="tool store">
      <header class="store-hero">
        <div class="store-hero-icon">🏪</div>
        <div class="store-hero-text">
          <b>Магазин Tulpar</b>
          <span class="dim small">ИИ, языки, базы данных и инструменты — в один клик, сам настраивается под {OS === "windows" ? "Windows" : OS === "mac" ? "macOS" : "Linux"}</span>
        </div>
        <span class="store-hero-stat" title="Уже установлено">✅ {installedCount()} / {ITEMS.length}</span>
        <input class="tool-input store-search" placeholder="🔍 Найти: python, postgres, redis…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
        <button onClick={refresh} title="Проверить, что установлено">⟳</button>
      </header>
      <div class="tool-tabs store-tabs">
        <For each={TABS}>{([id, label]) => <button classList={{ on: tab() === id && !q() }} onClick={() => { setQ(""); setTab(id); }}>{label}</button>}</For>
      </div>
      <Show when={!q() && tab() === "ai"}><StoreAi /></Show>
      <Show when={!q() && tab() === "remote"}><RemoteTab /></Show>
      <Show when={!q() && tab() === "network"}><NetworkTab /></Show>
      <Show when={catalogTab()}>
        <Show when={shown().length} fallback={<div class="tool-empty">Ничего не нашлось. Попробуйте другое слово.</div>}>
        <div class="store-grid">
          <For each={shown()}>{(it) => <Card item={it} onChange={refresh} />}</For>
        </div>
        </Show>
        <div class="dim small">
          {OS === "windows"
            ? "Всё ставится в папку Tulpar — без прав администратора и не мешая другим программам. Источники: официальные сайты и GitHub-релизы."
            : "На macOS ставится через Homebrew, на Linux — через ваш менеджер пакетов (apt, dnf, pacman). Команда откроется в терминале."}
        </div>
      </Show>
    </div>
  );
}
