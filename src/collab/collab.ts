// 👥 «Вместе по сети»: хозяин делится открытыми файлами, гости в той же сети
// правят их одновременно, видны курсоры друг друга. Без серверов в интернете.
import { createSignal } from "solid-js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { core, joinPath } from "../ipc";
import { root } from "../app/workspace";
import { tabs, modelFor, saveFile } from "../editor/tabs";
import { monaco, detectLanguage } from "../editor/monaco";
import { editorInstance } from "../editor/instance";
import { relOf } from "../problems/problems";
import { notify } from "../app/notify";
import { HostDoc, GuestDoc } from "./protocol";
import { type Op } from "./ot";

export interface Peer {
  id: string;
  name: string;
  color: number;
  file?: string;
  line?: number;
  col?: number;
}

type Msg = Record<string, any>;

const randomId = (n = 18) => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => abc[b % abc.length]).join("");
};

const [mode, setMode] = createSignal<"off" | "host" | "guest">("off");
const [peers, setPeers] = createSignal<Peer[]>([]);
const [hostUrl, setHostUrl] = createSignal("");
const [sharedFiles, setSharedFiles] = createSignal<string[]>([]);
const [guestFile, setGuestFile] = createSignal<string | null>(null);
const [status, setStatus] = createSignal("");
export { mode as collabMode, peers as collabPeers, hostUrl as collabUrl, sharedFiles, guestFile, status as collabStatus };

// ---------- Курсоры других людей ----------
const styleEl = document.createElement("style");
document.head.appendChild(styleEl);
const COLORS = ["#e5484d", "#30a46c", "#0090ff", "#f76b15", "#8e4ec6", "#e93d82", "#12a594", "#ffb224"];
function refreshPeerStyles() {
  styleEl.textContent = peers()
    .map((p) => {
      const c = COLORS[p.color % COLORS.length];
      const name = JSON.stringify(p.name).slice(1, -1).replace(/'/g, "\\'");
      return `.collab-caret.p-${p.id}{border-left:2px solid ${c};margin-left:-1px}.collab-caret.p-${p.id}::after{content:'${name}';background:${c}}`;
    })
    .join("\n");
}

function cursorDecorations(file: string): monaco.editor.IModelDeltaDecoration[] {
  return peers()
    .filter((p) => p.file === file && p.line)
    .map((p) => ({
      range: new monaco.Range(p.line!, p.col ?? 1, p.line!, p.col ?? 1),
      options: { beforeContentClassName: `collab-caret p-${p.id}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    }));
}

const opToEdit = (model: monaco.editor.ITextModel, op: Op) => {
  const start = model.getPositionAt(op.pos);
  const end = model.getPositionAt(op.pos + op.del);
  return { range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: op.ins, forceMoveMarkers: true };
};

// =====================================================================
// Хозяин
// =====================================================================
interface HostFile {
  path: string;
  doc: HostDoc;
  model: monaco.editor.ITextModel;
  sub: monaco.IDisposable;
}
const hostFiles = new Map<string, HostFile>(); // rel → файл
let applying: { from: string; id?: string } | null = null;
let unlistenInbox: UnlistenFn | null = null;
let hostTimers: number[] = [];
let hostDecor: monaco.editor.IEditorDecorationsCollection | null = null;
let outQueue: Msg[] = [];
let flushTimer = 0;

function broadcast(msg: Msg) {
  outQueue.push(msg);
  if (!flushTimer) {
    flushTimer = window.setTimeout(() => {
      flushTimer = 0;
      const batch = outQueue.splice(0).map((m) => JSON.stringify(m));
      void core.collabBroadcast(batch).catch(() => undefined);
    }, 15);
  }
}

function shareFile(path: string) {
  const model = modelFor(path);
  if (!model) return;
  const rel = relOf(path);
  if (hostFiles.has(rel)) return;
  const doc = new HostDoc(model.getValue());
  const sub = model.onDidChangeContent((e) => {
    // Несколько правок одного события: по убыванию смещения, тогда каждая
    // остаётся верной после предыдущей
    const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
    for (const c of changes) {
      const op: Op = { pos: c.rangeOffset, del: c.rangeLength, ins: c.text };
      const who = applying ?? { from: "host" };
      const item = doc.local(op, who.from, who.id);
      broadcast({ t: "op", f: rel, v: item.v, op, from: item.from, id: item.id });
      applying = null; // подтверждение — только первой из правок
    }
    if (doc.text !== model.getValue()) {
      // Разошлись (например, смена переводов строк) — шлём снимок
      doc.text = model.getValue();
      sendSnap(rel, undefined, true);
    }
  });
  hostFiles.set(rel, { path, doc, model, sub });
}

function sendSnap(rel: string, to?: string, force = false) {
  const f = hostFiles.get(rel);
  if (!f) return;
  broadcast({ t: "snap", f: rel, v: f.doc.version, text: f.doc.text, eol: f.model.getEOL(), lang: f.model.getLanguageId(), to, force });
}

function syncSharedTabs() {
  const open = tabs.filter((t) => !t.diffOf && modelFor(t.path)).map((t) => t.path);
  for (const p of open) shareFile(p);
  for (const [rel, f] of hostFiles) {
    if (!open.includes(f.path) || f.model.isDisposed()) {
      f.sub.dispose();
      hostFiles.delete(rel);
    }
  }
  const list = [...hostFiles.keys()].sort();
  if (list.join("\n") !== sharedFiles().join("\n")) {
    setSharedFiles(list);
    broadcast({ t: "files", list });
  }
}

function hostReceive(guest: string, raw: string) {
  let m: Msg;
  try {
    m = JSON.parse(raw);
  } catch {
    return;
  }
  const peer = peers().find((p) => p.id === guest);
  switch (m.t) {
    case "hello": {
      const name = String(m.name ?? "Гость").slice(0, 24) || "Гость";
      if (!peer) {
        setPeers([...peers(), { id: guest, name, color: peers().length + 1 }]);
        notify(`👥 ${name} подключился`);
        void import("../hype/achievements").then((a) => a.unlock("collab"));
      }
      refreshPeerStyles();
      broadcast({ t: "peers", list: [{ id: "host", name: hostName, color: 0 }, ...peers()] });
      broadcast({ t: "files", list: sharedFiles(), to: guest });
      break;
    }
    case "open":
      if (typeof m.f === "string") sendSnap(m.f, guest);
      break;
    case "op": {
      const f = hostFiles.get(m.f);
      if (!f) return;
      const op = f.doc.rebase(Number(m.base), m.op as Op);
      if (!op) {
        sendSnap(m.f, guest);
        return;
      }
      if (op.del === 0 && op.ins === "") {
        // Пустая после преобразования — всё равно подтверждаем
        const item = f.doc.local(op, guest, m.id);
        broadcast({ t: "op", f: m.f, v: item.v, op, from: guest, id: m.id });
        return;
      }
      applying = { from: guest, id: m.id };
      f.model.pushEditOperations([], [opToEdit(f.model, op)], () => null);
      applying = null;
      break;
    }
    case "cursor":
      if (peer) {
        setPeers(peers().map((p) => (p.id === guest ? { ...p, file: m.f, line: m.line, col: m.col } : p)));
        broadcast({ t: "cursor", id: guest, f: m.f, line: m.line, col: m.col });
        renderHostCursors();
      }
      break;
    case "save": {
      const f = hostFiles.get(m.f);
      if (f) void saveFile(f.path).then(() => broadcast({ t: "saved", f: m.f }));
      break;
    }
    case "bye":
      if (peer) {
        setPeers(peers().filter((p) => p.id !== guest));
        notify(`👥 ${peer.name} отключился`);
        broadcast({ t: "peers", list: [{ id: "host", name: hostName, color: 0 }, ...peers()] });
        renderHostCursors();
      }
      break;
  }
}

function renderHostCursors() {
  const editor = editorInstance();
  const model = editor?.getModel();
  if (!editor || !model) return;
  hostDecor ??= editor.createDecorationsCollection();
  const rel = [...hostFiles.entries()].find(([, f]) => f.model === model)?.[0];
  hostDecor.set(rel ? cursorDecorations(rel) : []);
}

let hostName = "Хозяин";

export async function startHost(name: string) {
  if (mode() !== "off") return;
  if (!root()) {
    notify("Откройте папку проекта, чтобы делиться файлами");
    return;
  }
  hostName = name.trim() || "Хозяин";
  const info = await core.collabStart(randomId(24));
  setHostUrl(info.url);
  setMode("host");
  setPeers([]);
  refreshPeerStyles();
  unlistenInbox = await listen<{ guest: string; msg: string }>("collab:inbox", (e) => hostReceive(e.payload.guest, e.payload.msg));
  syncSharedTabs();
  hostTimers.push(window.setInterval(syncSharedTabs, 1000));
  // Свой курсор — гостям
  let last = "";
  hostTimers.push(
    window.setInterval(() => {
      const editor = editorInstance();
      const model = editor?.getModel();
      const pos = editor?.getPosition();
      const rel = model ? [...hostFiles.entries()].find(([, f]) => f.model === model)?.[0] : undefined;
      const key = `${rel}:${pos?.lineNumber}:${pos?.column}`;
      if (rel && pos && key !== last) {
        last = key;
        broadcast({ t: "cursor", id: "host", f: rel, line: pos.lineNumber, col: pos.column });
      }
      renderHostCursors();
    }, 250),
  );
}

export async function stopHost() {
  if (mode() !== "host") return;
  broadcast({ t: "end" });
  await new Promise((r) => setTimeout(r, 100));
  await core.collabStop().catch(() => undefined);
  unlistenInbox?.();
  unlistenInbox = null;
  hostTimers.forEach(clearInterval);
  hostTimers = [];
  for (const f of hostFiles.values()) f.sub.dispose();
  hostFiles.clear();
  hostDecor?.clear();
  setPeers([]);
  setSharedFiles([]);
  setHostUrl("");
  setMode("off");
}

// =====================================================================
// Гость
// =====================================================================
interface GuestFile {
  doc: GuestDoc;
  model: monaco.editor.ITextModel;
  sub: monaco.IDisposable;
}
const guestFiles = new Map<string, GuestFile>();
let guest: { base: string; key: string; id: string; name: string; seq: number; alive: boolean } | null = null;
let applyingLocal = false;
let sendChain: Promise<unknown> = Promise.resolve();
const [guestVersion, setGuestVersion] = createSignal(0);
export { guestVersion };

function post(msg: Msg) {
  const g = guest;
  if (!g) return;
  sendChain = sendChain.then(() =>
    core
      .httpRequest({ method: "POST", url: `${g.base}/send?k=${g.key}&g=${g.id}`, headers: [["Content-Type", "application/json"]], body: JSON.stringify(msg), timeoutSecs: 10 })
      .catch(() => setStatus("Нет связи с хозяином…")),
  );
}

export function guestModel(rel: string): monaco.editor.ITextModel | undefined {
  return guestFiles.get(rel)?.model;
}

export function openGuestFile(rel: string) {
  setGuestFile(rel);
  if (!guestFiles.has(rel)) post({ t: "open", f: rel });
}

export function saveGuestFile() {
  const f = guestFile();
  if (f) post({ t: "save", f });
}

export function sendGuestCursor(rel: string, line: number, col: number) {
  post({ t: "cursor", f: rel, line, col });
}

export function guestCursorDecorations(rel: string) {
  return cursorDecorations(rel);
}

function guestHandle(m: Msg) {
  const g = guest;
  if (!g || (m.to && m.to !== g.id)) return;
  switch (m.t) {
    case "files":
      setSharedFiles(m.list ?? []);
      if (!guestFile() && m.list?.length) openGuestFile(m.list[0]);
      break;
    case "peers":
      setPeers((m.list as Peer[]).filter((p) => p.id !== g.id));
      refreshPeerStyles();
      break;
    case "snap": {
      const existing = guestFiles.get(m.f);
      if (existing && !m.to && !m.force) return; // снимок для другого гостя
      const text = String(m.text);
      if (existing) {
        applyingLocal = true;
        existing.model.setValue(text);
        applyingLocal = false;
        existing.doc = new GuestDoc(text, m.v);
      } else {
        const uri = monaco.Uri.from({ scheme: "tulpar-collab", path: "/" + m.f });
        monaco.editor.getModel(uri)?.dispose();
        const model = monaco.editor.createModel(text, m.lang || detectLanguage(m.f), uri);
        model.setEOL(m.eol === "\r\n" ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        const file: GuestFile = { doc: new GuestDoc(model.getValue(), m.v), model, sub: { dispose() {} } };
        file.sub = model.onDidChangeContent(() => {
          if (applyingLocal) return;
          const s = file.doc.edit(model.getValue());
          if (s) post({ t: "op", f: m.f, base: s.base, op: s.op, id: s.id });
        });
        guestFiles.set(m.f, file);
      }
      setGuestVersion((v) => v + 1);
      break;
    }
    case "op": {
      const f = guestFiles.get(m.f);
      if (!f || m.v <= f.doc.version) return;
      const res = f.doc.receive(m.v, m.op, m.id, m.from === g.id);
      if (res.local && (res.local.del || res.local.ins)) {
        applyingLocal = true;
        f.model.pushEditOperations([], [opToEdit(f.model, res.local)], () => null);
        applyingLocal = false;
        if (f.model.getValue() !== f.doc.text) {
          // На всякий случай: расхождение — просим снимок заново
          guestFiles.delete(m.f);
          f.sub.dispose();
          f.model.dispose();
          post({ t: "open", f: m.f });
        }
      }
      if (res.send) post({ t: "op", f: m.f, base: res.send.base, op: res.send.op, id: res.send.id });
      break;
    }
    case "cursor":
      setPeers(peers().map((p) => (p.id === m.id ? { ...p, file: m.f, line: m.line, col: m.col } : p)));
      setGuestVersion((v) => v + 1);
      break;
    case "saved":
      notify(`Сохранено у хозяина: ${m.f}`);
      break;
    case "end":
      notify("Хозяин завершил сессию");
      void leave(false);
      break;
  }
}

async function pollLoop() {
  while (guest?.alive) {
    const g = guest;
    try {
      const r = await core.httpRequest({ method: "GET", url: `${g.base}/events?k=${g.key}&since=${g.seq}`, headers: [], body: null, timeoutSecs: 30 });
      if (r.status === 403) {
        notify("Неверный ключ сессии — попросите новую ссылку", "error");
        void leave(false);
        return;
      }
      const data = JSON.parse(r.body) as { seq: number; reset: boolean; events: Msg[] };
      setStatus("");
      if (data.reset) {
        g.seq = data.seq;
        for (const [rel, f] of guestFiles) {
          f.sub.dispose();
          f.model.dispose();
          guestFiles.delete(rel);
        }
        post({ t: "hello", name: g.name });
        const cur = guestFile();
        if (cur) post({ t: "open", f: cur });
        continue;
      }
      g.seq = data.seq;
      for (const e of data.events) guestHandle(e);
    } catch {
      setStatus("Нет связи с хозяином, пробую снова…");
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export async function joinSession(link: string, name: string) {
  if (mode() !== "off") return;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    notify("Вставьте ссылку от хозяина целиком, например http://192.168.1.5:47830/?k=…", "error");
    return;
  }
  const key = url.searchParams.get("k");
  if (!key) {
    notify("В ссылке нет ключа ?k=…", "error");
    return;
  }
  guest = { base: `${url.protocol}//${url.host}`, key, id: randomId(12), name: name.trim() || "Гость", seq: 0, alive: true };
  // Начинаем с текущего конца журнала: старые события не нужны
  try {
    const r = await core.httpRequest({ method: "GET", url: `${guest.base}/events?k=${key}&since=999999999999`, headers: [], body: null, timeoutSecs: 8 });
    if (r.status === 403) throw new Error("неверный ключ");
    guest.seq = (JSON.parse(r.body) as { seq: number }).seq;
  } catch (e) {
    guest = null;
    notify(`Не удалось подключиться: ${e}. Компьютеры должны быть в одной сети Wi-Fi.`, "error");
    return;
  }
  setMode("guest");
  setPeers([]);
  void import("../hype/achievements").then((a) => a.unlock("collab"));
  post({ t: "hello", name: guest.name });
  void pollLoop();
}

export async function leave(tell = true) {
  if (mode() === "host") return stopHost();
  if (tell) post({ t: "bye" });
  if (guest) guest.alive = false;
  guest = null;
  for (const f of guestFiles.values()) {
    f.sub.dispose();
    f.model.dispose();
  }
  guestFiles.clear();
  setGuestFile(null);
  setSharedFiles([]);
  setPeers([]);
  setMode("off");
}

/** Гость хочет сохранить копию себе: путь в своей папке проекта. */
export async function guestSaveCopy() {
  const rel = guestFile();
  const model = rel ? guestModel(rel) : undefined;
  const r = root();
  if (!rel || !model || !r) {
    notify("Откройте у себя папку, куда сохранить копию");
    return;
  }
  const written = await core.agentWrite(joinPath(r, rel), model.getValue());
  notify(`Копия сохранена: ${written}`);
}
