// Блокноты Jupyter (.ipynb): чтение и запись формата nbformat 4 и связь с
// ядром — своим маленьким процессом Python (kernel.py), Jupyter не нужен.
import { core, events, parentDir } from "../ipc";
import { root } from "../app/workspace";
import KERNEL from "./kernel.py?raw";

export type CellType = "code" | "markdown" | "raw";

export interface Output {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  name?: "stdout" | "stderr";
  text?: string;
  data?: Record<string, string>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

export interface Cell {
  id: string;
  cell_type: CellType;
  source: string;
  outputs: Output[];
  execution_count: number | null;
  metadata: Record<string, unknown>;
  /** Поля, которые мы не трогаем, но сохраняем как были */
  extra: Record<string, unknown>;
}

export interface NotebookDoc {
  cells: Cell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

const join = (v: unknown) => (Array.isArray(v) ? v.join("") : typeof v === "string" ? v : "");
const split = (s: string) => s.split(/(?<=\n)/).filter((x, i, a) => x !== "" || i < a.length - 1);
export const newId = () => Math.random().toString(36).slice(2, 10);

export function parseNotebook(text: string): NotebookDoc {
  if (!text.trim()) return emptyNotebook();
  const raw = JSON.parse(text);
  const cells: Cell[] = (raw.cells ?? []).map((c: any) => {
    const { cell_type, source, outputs, execution_count, metadata, id, ...extra } = c;
    return {
      id: id ?? newId(),
      cell_type: cell_type ?? "code",
      source: join(source),
      outputs: (outputs ?? []).map((o: any) => ({
        ...o,
        text: o.text !== undefined ? join(o.text) : undefined,
        data: o.data ? Object.fromEntries(Object.entries(o.data).map(([k, v]) => [k, join(v)])) : undefined,
      })),
      execution_count: execution_count ?? null,
      metadata: metadata ?? {},
      extra,
    };
  });
  return { cells, metadata: raw.metadata ?? {}, nbformat: raw.nbformat ?? 4, nbformat_minor: raw.nbformat_minor ?? 5 };
}

export function emptyNotebook(): NotebookDoc {
  return {
    cells: [{ id: newId(), cell_type: "code", source: "", outputs: [], execution_count: null, metadata: {}, extra: {} }],
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function serializeNotebook(doc: NotebookDoc): string {
  const cells = doc.cells.map((c) => {
    const base: Record<string, unknown> = { ...c.extra, cell_type: c.cell_type, id: c.id, metadata: c.metadata, source: split(c.source) };
    if (c.cell_type === "code") {
      base.execution_count = c.execution_count;
      base.outputs = c.outputs.map((o) => {
        const out: Record<string, unknown> = { ...o };
        if (o.text !== undefined) out.text = split(o.text);
        if (o.data) out.data = Object.fromEntries(Object.entries(o.data).map(([k, v]) => [k, k.startsWith("image/") ? v : split(v)]));
        if (o.output_type !== "stream") out.metadata = o.metadata ?? {};
        return out;
      });
    }
    return base;
  });
  return JSON.stringify({ cells, metadata: doc.metadata, nbformat: doc.nbformat, nbformat_minor: Math.max(doc.nbformat_minor, 5) }, null, 1) + "\n";
}

// ---------- ядро ----------

export interface KernelHandlers {
  onOutput: (cellId: string, out: Output) => void;
  onDone: (cellId: string, count: number, ok: boolean) => void;
  onInput: (cellId: string, prompt: string) => Promise<string>;
  onExit: (stderr: string) => void;
}

export class Kernel {
  private unlisten: (() => void)[] = [];
  private constructor(readonly id: number, readonly python: string) {}

  static async start(notebookPath: string | null, h: KernelHandlers): Promise<Kernel> {
    const isWindows = navigator.userAgent.includes("Windows");
    const py = await pythonFor(root()) ?? (isWindows ? "python" : "python3");
    let kernel: Kernel | null = null;
    let readyResolve: () => void = () => undefined;
    const ready = new Promise<void>((r) => (readyResolve = r));
    const un1 = await events.onLspMessage((sid, message) => {
      if (!kernel || sid !== kernel.id) return;
      let m: any;
      try {
        m = JSON.parse(message);
      } catch {
        return;
      }
      if (m.type === "ready") readyResolve();
      else if (m.type === "stream") h.onOutput(m.id, { output_type: "stream", name: m.name, text: m.text });
      else if (m.type === "display") {
        const data: Record<string, string> = { [m.mime]: m.data };
        if (m.mime !== "text/plain") data["text/plain"] = m.text ?? "";
        h.onOutput(m.id, { output_type: "display_data", data, metadata: {} });
      } else if (m.type === "error") {
        h.onOutput(m.id, { output_type: "error", ename: m.ename, evalue: m.evalue, traceback: [m.traceback] });
      } else if (m.type === "done") h.onDone(m.id, m.count, m.ok);
      else if (m.type === "input_request") {
        void h.onInput(m.id, m.prompt).then((value) => kernel?.send({ type: "input_reply", value }));
      }
    });
    const un2 = await events.onLspExit((sid, stderr) => {
      if (kernel && sid === kernel.id) {
        kernel.dispose();
        h.onExit(stderr);
      }
    });
    let id: number;
    try {
      id = await core.lspStart(py, ["-u", "-c", KERNEL], notebookPath ? parentDir(notebookPath) : root());
    } catch (e) {
      un1();
      un2();
      throw e;
    }
    kernel = new Kernel(id, py);
    kernel.unlisten.push(un1, un2);
    await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error("Python не ответил за 20 секунд")), 20_000))]);
    return kernel;
  }

  send(msg: unknown) {
    void core.lspSend(this.id, JSON.stringify(msg)).catch(() => undefined);
  }

  execute(cellId: string, code: string) {
    this.send({ type: "execute", id: cellId, code });
  }

  dispose() {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
  }

  async stop() {
    this.dispose();
    await core.lspStop(this.id).catch(() => undefined);
  }
}

/** Python из виртуального окружения проекта, если есть. */
async function pythonFor(dir: string | null): Promise<string | null> {
  if (!dir) return null;
  const isWindows = navigator.userAgent.includes("Windows");
  const sep = dir.includes("\\") ? "\\" : "/";
  const entries = await core.readDir(dir).catch(() => []);
  for (const venv of [".venv", "venv", "env"]) {
    if (!entries.some((e) => e.isDir && e.name === venv)) continue;
    const bin = `${dir}${sep}${venv}${sep}${isWindows ? "Scripts" : "bin"}`;
    const names = (await core.readDir(bin).catch(() => [])).map((e) => e.name);
    if (isWindows && names.includes("python.exe")) return `${bin}${sep}python.exe`;
    if (!isWindows && names.includes("python")) return `${bin}/python`;
  }
  return null;
}
