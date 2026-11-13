// Модель вкладок: какие файлы открыты, какой активен, что не сохранено.
// Текст каждого файла хранится в модели Monaco; вкладка — лёгкая запись о ней.
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { ask } from "@tauri-apps/plugin-dialog";
import { monaco, detectLanguage } from "./monaco";
import { core, baseName } from "../ipc";
import { notifyError } from "../app/notify";
import { setting } from "../config/store";

export interface Tab {
  path: string;
  title: string;
  languageId: string;
  dirty: boolean;
}

const [tabs, setTabs] = createStore<Tab[]>([]);
const [activePath, setActivePath] = createSignal<string | null>(null);
const [cursor, setCursor] = createSignal({ line: 1, column: 1 });

export { tabs, activePath, setActivePath, cursor, setCursor };

const models = new Map<string, monaco.editor.ITextModel>();
const savedVersion = new Map<string, number>();
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();
const autoSaveTimers = new Map<string, number>();

export function modelFor(path: string) {
  return models.get(path);
}
export function saveViewState(path: string, state: monaco.editor.ICodeEditorViewState | null) {
  viewStates.set(path, state);
}
export function viewStateFor(path: string) {
  return viewStates.get(path) ?? null;
}

function setDirty(path: string, dirty: boolean) {
  setTabs((t) => t.path === path, "dirty", dirty);
}

/** Загрузить файл в модель Monaco, не открывая вкладку. Нужно языковым серверам:
 *  переход к определению и переименование работают с файлами, которые ещё не открыты. */
const pathOfModel = new WeakMap<monaco.editor.ITextModel, string>();

/** Модель для пути. Ищем и по URI: один и тот же файл может прийти в разном
 *  написании (например, «C:\\x» от проводника и «c:\\x» от языкового сервера). */
function existingModel(path: string) {
  return models.get(path) ?? monaco.editor.getModel(monaco.Uri.file(path)) ?? undefined;
}

export async function loadModel(path: string): Promise<monaco.editor.ITextModel | undefined> {
  const existing = existingModel(path);
  if (existing) return existing;
  let text: string;
  try {
    text = await core.readFile(path);
  } catch (e) {
    notifyError(`Не удалось открыть ${baseName(path)}`, e);
    return;
  }
  // Пока читали файл, его мог загрузить кто-то ещё
  const raced = existingModel(path);
  if (raced) return raced;
  const languageId = detectLanguage(path, text.slice(0, text.indexOf("\n") >>> 0));
  const model = monaco.editor.createModel(text, languageId, monaco.Uri.file(path));
  models.set(path, model);
  pathOfModel.set(model, path);
  savedVersion.set(path, model.getAlternativeVersionId());
  model.onDidChangeContent(() => {
    setDirty(path, model.getAlternativeVersionId() !== savedVersion.get(path));
    scheduleAutoSave(path);
  });
  return model;
}

const pendingReveal = new Map<string, monaco.IRange>();

/** Выделение, которое надо показать при следующем переключении на этот файл. */
export function takeReveal(path: string): monaco.IRange | undefined {
  const r = pendingReveal.get(path);
  pendingReveal.delete(path);
  return r;
}

export async function openFile(requested: string, reveal?: monaco.IRange) {
  const model = await loadModel(requested);
  if (!model) return;
  const path = pathOfModel.get(model) ?? requested;
  if (!tabs.some((t) => t.path === path)) {
    setTabs(produce((list) => list.push({ path, title: baseName(path), languageId: model.getLanguageId(), dirty: false })));
    setDirty(path, model.getAlternativeVersionId() !== savedVersion.get(path));
  }
  if (reveal) pendingReveal.set(path, reveal);
  // Повторная установка того же пути не вызовет эффект, поэтому сбрасываем
  if (activePath() === path && reveal) setActivePath(null);
  setActivePath(path);
  persistSession();
}

function scheduleAutoSave(path: string) {
  if (setting("files.autoSave") !== "afterDelay") return;
  clearTimeout(autoSaveTimers.get(path));
  autoSaveTimers.set(path, window.setTimeout(() => void saveFile(path), setting("files.autoSaveDelay")));
}

type SaveListener = (model: monaco.editor.ITextModel) => void;
const saveListeners: SaveListener[] = [];
export function onDidSave(cb: SaveListener) {
  saveListeners.push(cb);
}

export async function saveFile(path: string | null = activePath()) {
  if (!path) return;
  const model = models.get(path);
  if (!model) return;
  const version = model.getAlternativeVersionId();
  await core.writeFile(path, model.getValue());
  savedVersion.set(path, version);
  setDirty(path, model.getAlternativeVersionId() !== version);
  for (const cb of saveListeners) cb(model);
}

export async function saveAll() {
  for (const t of tabs.filter((t) => t.dirty)) await saveFile(t.path);
}

export async function closeTab(path: string | null = activePath()) {
  if (!path) return;
  const tab = tabs.find((t) => t.path === path);
  if (!tab) return;
  if (tab.dirty) {
    const save = await ask(`Сохранить изменения в «${tab.title}»?`, {
      title: "Tulpar",
      kind: "warning",
      okLabel: "Сохранить",
      cancelLabel: "Не сохранять",
    });
    if (save) await saveFile(path);
  }
  const index = tabs.findIndex((t) => t.path === path);
  setTabs(produce((list) => list.splice(index, 1)));
  models.get(path)?.dispose();
  models.delete(path);
  savedVersion.delete(path);
  viewStates.delete(path);
  if (activePath() === path) {
    const next = tabs[Math.min(index, tabs.length - 1)];
    setActivePath(next?.path ?? null);
  }
  persistSession();
}

export function cycleTab(step: 1 | -1) {
  if (tabs.length === 0) return;
  const i = tabs.findIndex((t) => t.path === activePath());
  const next = tabs[(i + step + tabs.length) % tabs.length];
  setActivePath(next.path);
  persistSession();
}

/** Файл изменился на диске (другой программой или git). Если у нас нет несохранённых
 *  правок — тихо подтягиваем новую версию. */
export async function onDiskChange(path: string) {
  const model = models.get(path);
  const tab = tabs.find((t) => t.path === path);
  if (!model || !tab || tab.dirty) return;
  try {
    const text = await core.readFile(path);
    if (text !== model.getValue()) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
      savedVersion.set(path, model.getAlternativeVersionId());
      setDirty(path, false);
    }
  } catch {
    // файл удалён или стал недоступен — оставляем вкладку как есть
  }
}

export async function closeAll() {
  for (const t of [...tabs]) await closeTab(t.path);
}

// ---------- восстановление сессии ----------

const SESSION_KEY = "tulpar.session";

export interface Session {
  root: string | null;
  tabs: string[];
  active: string | null;
}

let currentRoot: string | null = null;
export function setSessionRoot(root: string | null) {
  currentRoot = root;
  persistSession();
}

function persistSession() {
  const session: Session = { root: currentRoot, tabs: tabs.map((t) => t.path), active: activePath() };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // хранилище недоступно — просто не восстановим сессию
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
