// Перетаскивание файлов.
//
// 1. Внутри дерева: тянем файл или папку мышью на другую папку.
//    Сделано на событиях указателя, а не на HTML-перетаскивании: на Windows оно
//    не работает, пока окно принимает файлы из системы.
// 2. Из проводника системы: бросаем файлы на папку в дереве.
//
// В обоих случаях в конце — меню «Переместить сюда / Копировать сюда».
// Картинка, брошенная мимо дерева, по-прежнему становится фоном.
import { createSignal } from "solid-js";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { core, baseName, parentDir, sepOf } from "../ipc";
import { root, reloadDir } from "../app/workspace";
import { showContextMenuAt } from "../app/ContextMenu";
import { notify, notifyError } from "../app/notify";
import { setBackgroundFrom } from "../app/background";
import { tabsUnder } from "../editor/tabs";
import { retarget, setFolderOpen, setSelected } from "./fileOps";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
const THRESHOLD = 5;

const [dropTarget, setDropTarget] = createSignal<string | null>(null);
const [ghost, setGhost] = createSignal<{ x: number; y: number; label: string } | null>(null);
export { dropTarget, ghost };

/** Папка под точкой окна: сама папка, папка файла или корень, если над пустым местом дерева. */
function folderAt(x: number, y: number): string | null {
  const r = root();
  if (!r) return null;
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const item = el.closest<HTMLElement>(".tree-item[data-path]");
  if (item) return item.dataset.dir === "1" ? item.dataset.path! : parentDir(item.dataset.path!);
  return el.closest(".tree") ? r : null;
}

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "элемент";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "элемента";
  return "элементов";
}

async function transfer(sources: string[], target: string, mode: "copy" | "move", internal: boolean) {
  // Открытые файлы с несохранёнными правками не переносим — правки бы потерялись
  if (mode === "move" && sources.some((s) => tabsUnder(s).some((t) => t.dirty))) {
    notify("Сначала сохраните открытые файлы, которые перемещаете", "error");
    return;
  }
  try {
    const results = await core.transferPaths(sources, target, mode);
    if (mode === "move" && internal) {
      for (let i = 0; i < sources.length; i++) {
        if (results[i] !== sources[i]) await retarget(sources[i], results[i]);
        reloadDir(parentDir(sources[i]));
      }
    }
    if (target !== root()) setFolderOpen(target, true);
    reloadDir(target);
    if (results.length === 1) setSelected(results[0]);
    notify(`${mode === "copy" ? "Скопировано" : "Перемещено"}: ${results.length} ${plural(results.length)}`);
  } catch (e) {
    notifyError(mode === "copy" ? "Не удалось скопировать" : "Не удалось переместить", e);
  }
}

function askWhatToDo(x: number, y: number, sources: string[], target: string, internal: boolean) {
  const sep = sepOf(target);
  const into = baseName(target);
  const insideItself = sources.some((s) => target === s || target.startsWith(s + sep));
  const alreadyHere = sources.every((s) => parentDir(s) === target);
  const items: Parameters<typeof showContextMenuAt>[2] = [];
  if (!insideItself && !alreadyHere) {
    items.push({ label: `Переместить в «${into}»`, run: () => void transfer(sources, target, "move", internal) });
  }
  if (!insideItself) {
    items.push({ label: `Копировать в «${into}»`, run: () => void transfer(sources, target, "copy", internal) });
  }
  if (!items.length) {
    notify("Нельзя поместить папку внутрь самой себя", "error");
    return;
  }
  items.push("-", { label: "Отмена", run: () => undefined });
  showContextMenuAt(x, y, items);
}

/** Начало возможного перетаскивания по дереву (нажатие на элемент). */
export function startTreeDrag(e: PointerEvent, path: string) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = false;

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      dragging = true;
      document.body.classList.add("dragging-file");
    }
    setGhost({ x: ev.clientX, y: ev.clientY, label: baseName(path) });
    setDropTarget(folderAt(ev.clientX, ev.clientY));
  };
  const finish = (ev: PointerEvent | null) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    document.body.classList.remove("dragging-file");
    const target = dropTarget();
    setGhost(null);
    setDropTarget(null);
    if (!dragging || !ev || !target) return;
    // Клик сразу после перетаскивания не должен открыть файл. Если браузер клик
    // не пришлёт, через мгновение снимаем перехват, чтобы не съесть следующий.
    const swallow = (c: MouseEvent) => c.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    askWhatToDo(ev.clientX, ev.clientY, [path], target, true);
  };
  const up = (ev: PointerEvent) => finish(ev);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      dragging = false;
      finish(null);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}

/** Файлы из системы: подсветка папки под курсором и меню после броска. */
export async function initFileDrop() {
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "leave") {
        setDropTarget(null);
        return;
      }
      // Ядро присылает координаты в физических пикселях
      const scale = window.devicePixelRatio || 1;
      const x = p.position.x / scale;
      const y = p.position.y / scale;
      const target = folderAt(x, y);
      if (p.type === "enter" || p.type === "over") {
        setDropTarget(target);
        return;
      }
      setDropTarget(null);
      if (target) {
        askWhatToDo(x, y, p.paths, target, false);
        return;
      }
      const image = p.paths.find((path) => IMAGE_RE.test(path));
      if (image) void setBackgroundFrom(image);
      else if (root()) notify("Чтобы добавить файлы в проект, бросьте их на папку в проводнике");
    });
  } catch (e) {
    console.warn("Перетаскивание файлов недоступно", e);
  }
}
