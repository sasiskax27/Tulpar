// Менеджер языковых серверов: запускает сервер, когда открыт файл его языка,
// синхронизирует с ним текст документов и показывает ошибки.
//
// Один сервер обслуживает все файлы своего языка в открытой папке.
// Языки с одинаковой командой (C и C++ → clangd) делят один сервер.
import { createEffect, createRoot, on } from "solid-js";
import { monaco } from "../editor/monaco";
import { core, events, baseName } from "../ipc";
import { languages, type ServerConfig } from "../config/store";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { onDidSave } from "../editor/tabs";
import { LspClient } from "./client";
import { toRange, toSeverity } from "./convert";
import { ensureProviders } from "./bridge";

const MARKER_OWNER = "lsp";
const CHANGE_DELAY = 150;

/** Ключ сервера (команда + аргументы) → клиент. */
const clients = new Map<string, Promise<LspClient | null>>();
const byServerId = new Map<number, LspClient>();
const warnedMissing = new Set<string>();

interface Doc {
  client: LspClient;
  version: number;
  timer?: number;
  dirty: boolean;
  subscription: monaco.IDisposable;
}
const docs = new Map<string, Doc>(); // uri → документ

const clientCapabilities = {
  general: { positionEncodings: ["utf-16"] },
  workspace: { configuration: true, workspaceFolders: true, applyEdit: false },
  window: { workDoneProgress: true, showMessage: {} },
  textDocument: {
    synchronization: { didSave: true, dynamicRegistration: false },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        labelDetailsSupport: true,
        insertReplaceSupport: true,
      },
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ["markdown", "plaintext"],
        parameterInformation: { labelOffsetSupport: true },
      },
    },
    definition: { linkSupport: true },
    references: {},
    rename: { prepareSupport: false },
    formatting: {},
    publishDiagnostics: { relatedInformation: false },
  },
};

function serverKey(cfg: ServerConfig): string {
  return [cfg.command, ...(cfg.args ?? [])].join(" ");
}

async function startServer(cfg: ServerConfig): Promise<LspClient | null> {
  const key = serverKey(cfg);
  const r = root();
  let id: number;
  try {
    id = await core.lspStart(cfg.command, cfg.args ?? [], r);
  } catch (e) {
    const msg = String(e);
    if (msg.startsWith("not-found:")) {
      if (!warnedMissing.has(key)) {
        warnedMissing.add(key);
        notify(`Языковой сервер ${cfg.command} не найден.${cfg.install ? ` Установите: ${cfg.install}` : ""}`);
      }
    } else {
      notify(msg, "error");
    }
    return null;
  }

  const client = new LspClient(id, cfg.command);
  byServerId.set(id, client);

  client.onNotification("textDocument/publishDiagnostics", (p) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(p.uri));
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      (p.diagnostics ?? []).map((d: any) => ({
        ...toRange(d.range),
        severity: toSeverity(d.severity),
        message: d.message,
        source: d.source,
        code: d.code === undefined ? undefined : String(d.code),
      })),
    );
  });
  client.onNotification("window/showMessage", (p) => notify(`${cfg.command}: ${p.message}`, p.type === 1 ? "error" : "info"));
  client.onRequest("workspace/configuration", (p) => (p.items ?? []).map(() => null));
  client.onRequest("workspace/workspaceFolders", () =>
    r ? [{ uri: monaco.Uri.file(r).toString(), name: baseName(r) }] : null,
  );
  client.onRequest("client/registerCapability", () => null);
  client.onRequest("client/unregisterCapability", () => null);
  client.onRequest("window/workDoneProgress/create", () => null);
  client.onRequest("window/showMessageRequest", () => null);

  try {
    const rootUri = r ? monaco.Uri.file(r).toString() : null;
    const result = await client.request("initialize", {
      processId: null,
      clientInfo: { name: "Tulpar", version: "0.1.0" },
      rootUri,
      rootPath: r,
      workspaceFolders: r ? [{ uri: rootUri, name: baseName(r) }] : null,
      capabilities: clientCapabilities,
    });
    client.capabilities = result?.capabilities ?? {};
    client.notify("initialized", {});
  } catch (e) {
    notify(`${cfg.command} не запустился: ${e instanceof Error ? e.message : e}`, "error");
    client.dispose();
    byServerId.delete(id);
    void core.lspStop(id);
    clients.delete(key);
    return null;
  }
  return client;
}

function clientForLanguage(languageId: string): Promise<LspClient | null> | null {
  const cfg = languages()[languageId];
  if (!cfg?.command) return null;
  const key = serverKey(cfg);
  let p = clients.get(key);
  if (!p) {
    p = startServer(cfg);
    clients.set(key, p);
  }
  return p;
}

async function attach(model: monaco.editor.ITextModel) {
  if (model.uri.scheme !== "file") return;
  const languageId = model.getLanguageId();
  const pending = clientForLanguage(languageId);
  if (!pending) return;
  const client = await pending;
  if (!client || model.isDisposed()) return;
  const uri = model.uri.toString();
  if (docs.has(uri)) return;

  ensureProviders(languageId, client);
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId, version: 1, text: model.getValue() },
  });
  const doc: Doc = {
    client,
    version: 1,
    dirty: false,
    subscription: model.onDidChangeContent(() => {
      doc.dirty = true;
      clearTimeout(doc.timer);
      doc.timer = window.setTimeout(() => flush(model), CHANGE_DELAY);
    }),
  };
  docs.set(uri, doc);
}

/** Отправить серверу накопленные правки (полный текст — просто и надёжно;
 *  инкрементальная синхронизация — оптимизация на потом). */
function flush(model: monaco.editor.ITextModel) {
  const doc = docs.get(model.uri.toString());
  if (!doc || !doc.dirty || model.isDisposed()) return;
  clearTimeout(doc.timer);
  doc.dirty = false;
  doc.version += 1;
  doc.client.notify("textDocument/didChange", {
    textDocument: { uri: model.uri.toString(), version: doc.version },
    contentChanges: [{ text: model.getValue() }],
  });
}

function detach(model: monaco.editor.ITextModel) {
  const uri = model.uri.toString();
  const doc = docs.get(uri);
  if (!doc) return;
  clearTimeout(doc.timer);
  doc.subscription.dispose();
  docs.delete(uri);
  doc.client.notify("textDocument/didClose", { textDocument: { uri } });
}

/** Клиент для документа — с уже отправленными последними правками. */
export function clientFor(model: monaco.editor.ITextModel): LspClient | undefined {
  const doc = docs.get(model.uri.toString());
  if (!doc || !doc.client.alive) return;
  flush(model);
  return doc.client;
}

async function stopAll() {
  const all = [...byServerId.entries()];
  byServerId.clear();
  clients.clear();
  for (const [, doc] of docs) {
    clearTimeout(doc.timer);
    doc.subscription.dispose();
  }
  docs.clear();
  for (const model of monaco.editor.getModels()) monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
  await Promise.all(
    all.map(async ([id, client]) => {
      try {
        await Promise.race([client.request("shutdown", null), new Promise((r) => setTimeout(r, 1000))]);
        client.notify("exit", null);
      } catch {
        // сервер уже не отвечает — просто останавливаем
      }
      client.dispose();
      await core.lspStop(id).catch(() => undefined);
    }),
  );
}

async function restart() {
  await stopAll();
  for (const model of monaco.editor.getModels()) void attach(model);
}

export async function initLsp() {
  await events.onLspMessage((id, message) => void byServerId.get(id)?.handle(message));
  await events.onLspExit((id) => {
    const client = byServerId.get(id);
    if (!client) return;
    client.dispose();
    byServerId.delete(id);
    for (const [key, p] of clients) {
      void p.then((c) => {
        if (c === client) clients.delete(key);
      });
    }
    for (const [uri, doc] of docs) if (doc.client === client) docs.delete(uri);
    notify(`Языковой сервер ${client.name} завершился. Откройте файл заново, чтобы перезапустить.`, "error");
    void core.lspStop(id);
  });

  monaco.editor.onDidCreateModel((model) => void attach(model));
  monaco.editor.onWillDisposeModel(detach);
  monaco.editor.onDidChangeModelLanguage((e) => {
    detach(e.model);
    void attach(e.model);
  });
  onDidSave((model) => {
    const doc = docs.get(model.uri.toString());
    if (!doc) return;
    flush(model);
    doc.client.notify("textDocument/didSave", { textDocument: { uri: model.uri.toString() } });
  });

  // Другая папка или изменился languages.json → перезапускаем серверы
  createRoot(() => {
    createEffect(on([root, languages], () => void restart(), { defer: true }));
  });

  for (const model of monaco.editor.getModels()) void attach(model);
}

export { restart as restartLanguageServers };
