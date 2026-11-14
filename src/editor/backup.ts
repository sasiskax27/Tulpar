// Резервные копии несохранённых правок и их восстановление при запуске.
//
// Пока у файла есть несохранённые правки, через секунду после каждого изменения
// его текст пишется в резервную копию. Сохранили или закрыли без сохранения —
// копия удаляется. Если Tulpar закрылся с несохранёнными файлами, при следующем
// запуске он предложит их вернуть.
import { ask } from "../i18n/dialog";
import { monaco } from "./monaco";
import { core, baseName } from "../ipc";
import { tabs, onDidSave, openFile, modelFor } from "./tabs";
import { notify } from "../app/notify";
import { root } from "../app/workspace";

interface Backup {
  path: string;
  content: string;
  time: number;
}

const DELAY = 1000;
const timers = new Map<string, number>();

/** Имя копии: короткий хеш пути (FNV-1a), только буквы и цифры. */
function nameFor(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `b${h.toString(16)}-${path.length}`;
}

function isDirty(path: string) {
  return tabs.some((t) => t.path === path && t.dirty);
}

function schedule(model: monaco.editor.ITextModel) {
  const path = model.uri.fsPath;
  clearTimeout(timers.get(path));
  timers.set(
    path,
    window.setTimeout(() => {
      if (model.isDisposed()) return;
      const name = nameFor(path);
      if (isDirty(path)) {
        const data: Backup = { path, content: model.getValue(), time: Date.now() };
        void core.backupPut(name, JSON.stringify(data)).catch(() => undefined);
      } else {
        void core.backupDelete(name).catch(() => undefined);
      }
    }, DELAY),
  );
}

function drop(path: string) {
  clearTimeout(timers.get(path));
  void core.backupDelete(nameFor(path)).catch(() => undefined);
}

export function initBackups() {
  const watch = (model: monaco.editor.ITextModel) => {
    if (model.uri.scheme !== "file") return;
    model.onDidChangeContent(() => schedule(model));
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
  // Закрыли вкладку (модель удаляется) или сохранили — копия больше не нужна
  monaco.editor.onWillDisposeModel((m) => m.uri.scheme === "file" && drop(m.uri.fsPath));
  onDidSave((m) => drop(m.uri.fsPath));
}

/** При запуске: найти копии, которые отличаются от файлов на диске, и предложить вернуть. */
const offered = new Set<string>();

export async function offerRestore() {
  // Спрашиваем один раз на папку за запуск
  const current = root();
  if (!current || offered.has(current)) return;
  offered.add(current);
  let list: [string, string][];
  try {
    list = await core.backupList();
  } catch {
    return;
  }
  const r = root();
  if (!r) return;
  const pending: { name: string; backup: Backup }[] = [];
  for (const [name, data] of list) {
    try {
      const backup = JSON.parse(data) as Backup;
      // Копии из других проектов ждут, пока откроют их папку
      if (!backup.path.startsWith(r)) continue;
      const onDisk = await core.readFile(backup.path).catch(() => null);
      if (onDisk === backup.content) await core.backupDelete(name);
      else pending.push({ name, backup });
    } catch {
      await core.backupDelete(name).catch(() => undefined);
    }
  }
  if (!pending.length) return;

  const names = pending.map((p) => baseName(p.backup.path)).slice(0, 5).join(", ");
  const more = pending.length > 5 ? ` и ещё ${pending.length - 5}` : "";
  const restore = await ask(
    `Tulpar закрылся с несохранёнными изменениями: ${names}${more}.\n\nВернуть их? Файлы откроются с правками, но не будут сохранены, пока вы не нажмёте Ctrl+S.`,
    { title: "Tulpar", kind: "info", okLabel: "Вернуть", cancelLabel: "Удалить копии" },
  );
  for (const { name, backup } of pending) {
    if (!restore) {
      await core.backupDelete(name).catch(() => undefined);
      continue;
    }
    try {
      await openFile(backup.path);
      const model = modelFor(backup.path) ?? monaco.editor.getModel(monaco.Uri.file(backup.path));
      if (model) {
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: backup.content }], () => null);
      }
    } catch {
      notify(`Не удалось вернуть ${baseName(backup.path)}: файл недоступен`, "error");
    }
  }
}
