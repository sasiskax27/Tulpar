// ⏳ Машина времени: копия файла при каждом сохранении (в IndexedDB, только
// на этом компьютере). Работает и без git, и между коммитами.
import { createSignal } from "solid-js";

export interface Snapshot {
  id?: number;
  path: string;
  time: number;
  content: string;
  /** Откуда копия: сохранение, перед восстановлением, перед правкой ИИ */
  reason: "save" | "restore" | "ai";
}

const DB = "tulpar-history";
const STORE = "snapshots";
const PER_FILE = 80;
const MAX_SIZE = 1_000_000;

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("path", "path");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const [version, setVersion] = createSignal(0);
export { version as historyVersion };

export async function snapshots(path: string): Promise<Snapshot[]> {
  const d = await db();
  const list = await wrap(d.transaction(STORE).objectStore(STORE).index("path").getAll(path) as IDBRequest<Snapshot[]>);
  return list.sort((a, b) => b.time - a.time);
}

export async function addSnapshot(path: string, content: string, reason: Snapshot["reason"] = "save") {
  if (content.length > MAX_SIZE || path.startsWith("diff:")) return;
  try {
    const list = await snapshots(path);
    if (list[0]?.content === content) return; // ничего не поменялось
    const d = await db();
    const tx = d.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.add({ path, time: Date.now(), content, reason } satisfies Snapshot);
    for (const old of list.slice(PER_FILE - 1)) if (old.id != null) store.delete(old.id);
    await new Promise((r) => (tx.oncomplete = r));
    setVersion((v) => v + 1);
  } catch {
    /* IndexedDB недоступна — тихо без истории */
  }
}

export async function clearHistory(path: string) {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  for (const s of await snapshots(path)) if (s.id != null) tx.objectStore(STORE).delete(s.id);
  await new Promise((r) => (tx.oncomplete = r));
  setVersion((v) => v + 1);
}

/** Сколько строк добавлено и убрано между двумя текстами (грубо, по множествам строк). */
export function lineDelta(older: string, newer: string): { added: number; removed: number } {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(older);
  const b = count(newer);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed };
}

export function ago(time: number): string {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return "только что";
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(time).toLocaleString();
}
