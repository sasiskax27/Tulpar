// GitHub Copilot: подсказки при наборе через официальный Copilot Language Server
// (npm: @github/copilot-language-server), который GitHub выпускает для любых
// редакторов. Работает и с бесплатным тарифом Copilot Free. Вход — через GitHub
// в браузере (код устройства).
import { createSignal } from "solid-js";
import { monaco } from "../editor/monaco";
import { core, events } from "../ipc";
import { settings } from "../config/store";
import { root } from "../app/workspace";
import { notify, notifyError } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";
import { activePath, modelFor } from "../editor/tabs";
import { LspClient } from "../lsp/client";

export type CopilotState = "off" | "starting" | "signedOut" | "ready" | "error" | "missing";

const [state, setState] = createSignal<CopilotState>("off");
const [user, setUser] = createSignal<string | null>(null);
export { state as copilotState, user as copilotUser };

let client: LspClient | null = null;
let starting: Promise<LspClient | null> | null = null;
const versions = new Map<string, number>();
const subs = new Map<string, monaco.IDisposable>();

export function copilotEnabled(): boolean {
  return !!settings()["tulpar.ai.inline"] && settings()["tulpar.ai.inlineProvider"] === "copilot";
}

function sendOpen(model: monaco.editor.ITextModel) {
  if (!client || model.uri.scheme !== "file") return;
  const uri = model.uri.toString();
  if (versions.has(uri)) return;
  versions.set(uri, 1);
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: model.getLanguageId(), version: 1, text: model.getValue() },
  });
  // Copilot требует инкрементальную синхронизацию: шлём только изменённые куски
  subs.set(
    uri,
    model.onDidChangeContent((e) => {
      if (!client) return;
      const version = (versions.get(uri) ?? 1) + 1;
      versions.set(uri, version);
      client.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: e.changes.map((c) => ({
          range: {
            start: { line: c.range.startLineNumber - 1, character: c.range.startColumn - 1 },
            end: { line: c.range.endLineNumber - 1, character: c.range.endColumn - 1 },
          },
          rangeLength: c.rangeLength,
          text: c.text,
        })),
      });
    }),
  );
}

function sendClose(model: monaco.editor.ITextModel) {
  const uri = model.uri.toString();
  subs.get(uri)?.dispose();
  subs.delete(uri);
  if (versions.delete(uri)) client?.notify("textDocument/didClose", { textDocument: { uri } });
}

async function start(): Promise<LspClient | null> {
  if (client) return client;
  if (starting) return starting;
  starting = (async () => {
    setState("starting");
    let id: number;
    try {
      id = await core.lspStart("copilot-language-server", ["--stdio"], root());
    } catch (e) {
      const missing = String(e).startsWith("not-found:");
      setState(missing ? "missing" : "error");
      if (missing) {
        notify("Для Copilot нужен официальный Copilot Language Server от GitHub. Установить его (npm)?", "info", [
          {
            label: "Установить",
            run: () => {
              void runInTerminal("npm install -g @github/copilot-language-server", "Установка Copilot");
              notify("Когда установка закончится, перезапустите Tulpar.");
            },
          },
        ]);
      } else notifyError("Copilot не запустился", e);
      return null;
    }
    const c = new LspClient(id, "Copilot");
    const unlisten = await events.onLspMessage((sid, message) => {
      if (sid === id) void c.handle(message);
    });
    c.onNotification("didChangeStatus", (p) => {
      if (p?.kind === "Error") setState("signedOut");
      else if (p?.kind === "Normal" && state() !== "ready") void checkStatus();
    });
    c.onNotification("window/logMessage", () => undefined);
    c.onRequest("workspace/configuration", (p) => (p.items ?? []).map(() => ({})));
    c.onRequest("window/showDocument", (p) => {
      // Страница входа GitHub — открываем в браузере
      if (typeof p?.uri === "string") void core.openUrl(p.uri).catch(() => undefined);
      return { success: true };
    });
    c.onRequest("window/showMessageRequest", () => null);
    c.onRequest("window/workDoneProgress/create", () => null);
    try {
      const r = root();
      await c.request("initialize", {
        processId: null,
        rootUri: r ? monaco.Uri.file(r).toString() : null,
        workspaceFolders: r ? [{ uri: monaco.Uri.file(r).toString(), name: r.split(/[\\/]/).pop() }] : null,
        capabilities: { workspace: { workspaceFolders: true }, window: { showDocument: { support: true } } },
        initializationOptions: {
          editorInfo: { name: "Tulpar", version: "0.1.0" },
          editorPluginInfo: { name: "tulpar-copilot", version: "0.1.0" },
        },
      });
      c.notify("initialized", {});
      c.notify("workspace/didChangeConfiguration", { settings: { telemetry: { telemetryLevel: "off" } } });
    } catch (e) {
      unlisten();
      setState("error");
      notifyError("Copilot не запустился", e);
      void core.lspStop(id);
      return null;
    }
    client = c;
    for (const model of monaco.editor.getModels()) sendOpen(model);
    await checkStatus();
    return c;
  })();
  const result = await starting;
  starting = null;
  return result;
}

async function checkStatus() {
  if (!client) return;
  try {
    const r = await client.request<any>("checkStatus", {});
    if (r?.status === "OK" || r?.status === "AlreadySignedIn" || r?.user) {
      setUser(r.user ?? null);
      setState("ready");
    } else {
      setUser(null);
      setState("signedOut");
    }
  } catch {
    setState("signedOut");
  }
}

/** Вход в GitHub Copilot: показываем код, открываем страницу GitHub. */
export async function copilotSignIn() {
  const c = await start();
  if (!c) return;
  try {
    const r = await c.request<any>("signIn", {});
    if (r?.status === "AlreadySignedIn") {
      await checkStatus();
      notify(`Copilot: вы уже вошли${user() ? " как " + user() : ""}`);
      return;
    }
    if (r?.userCode) {
      await navigator.clipboard.writeText(r.userCode).catch(() => undefined);
      notify(`Код для входа: ${r.userCode} (уже скопирован). Откроется GitHub — вставьте код и подтвердите.`, "info", [
        { label: "Открыть GitHub", run: () => void c.request("workspace/executeCommand", r.command).then(checkStatus).catch(() => undefined) },
      ]);
      // Сразу запускаем завершение входа — сервер сам откроет страницу
      void c.request("workspace/executeCommand", r.command).then(checkStatus).catch(() => undefined);
    }
  } catch (e) {
    notifyError("Не удалось начать вход в Copilot", e);
  }
}

export async function copilotSignOut() {
  if (!client) return;
  await client.request("signOut", {}).catch(() => undefined);
  setUser(null);
  setState("signedOut");
  notify("Вы вышли из Copilot");
}

/** Подсказка Copilot в точке курсора. */
async function inlineCompletion(model: monaco.editor.ITextModel, position: monaco.Position) {
  const c = await start();
  if (!c || state() !== "ready") return [];
  sendOpen(model);
  const uri = model.uri.toString();
  const s = settings();
  const r = await c
    .request<any>("textDocument/inlineCompletion", {
      textDocument: { uri, version: versions.get(uri) ?? 1 },
      position: { line: position.lineNumber - 1, character: position.column - 1 },
      context: { triggerKind: 2 },
      formattingOptions: { tabSize: s["editor.tabSize"], insertSpaces: s["editor.insertSpaces"] },
    })
    .catch(() => null);
  return (r?.items ?? []) as {
    insertText: string;
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
    command?: { command: string; arguments?: unknown[] };
  }[];
}

export function initCopilot() {
  const commandId = "tulpar.copilot.accepted";
  monaco.editor.registerCommand(commandId, (_accessor, cmd: { command: string; arguments?: unknown[] }) => {
    // Copilot просит сообщить о принятой подсказке
    void client?.request("workspace/executeCommand", cmd).catch(() => undefined);
  });

  monaco.languages.registerInlineCompletionsProvider("*", {
    async provideInlineCompletions(model, position, _context, token) {
      if (!copilotEnabled() || model.uri.scheme !== "file") return { items: [] };
      await new Promise((r) => setTimeout(r, 150));
      if (token.isCancellationRequested) return { items: [] };
      const items = await inlineCompletion(model, position);
      if (token.isCancellationRequested) return { items: [] };
      return {
        items: items.map((it) => ({
          insertText: it.insertText,
          range: it.range
            ? new monaco.Range(it.range.start.line + 1, it.range.start.character + 1, it.range.end.line + 1, it.range.end.character + 1)
            : undefined,
          command: it.command ? { id: commandId, title: "", arguments: [it.command] } : undefined,
        })),
      };
    },
    freeInlineCompletions() {},
  });

  monaco.editor.onDidCreateModel((m) => client && sendOpen(m));
  monaco.editor.onWillDisposeModel(sendClose);

  // Copilot хочет знать, какой файл сейчас перед глазами
  let lastFocus: string | null = null;
  window.setInterval(() => {
    const path = activePath();
    if (!client || !path || path === lastFocus) return;
    lastFocus = path;
    const model = modelFor(path);
    if (model) client.notify("textDocument/didFocus", { textDocument: { uri: model.uri.toString() } });
  }, 500);

  // Если Copilot выбран — запускаем сервер при старте
  window.setTimeout(() => {
    if (copilotEnabled()) void start();
  }, 2000);
}

export function ensureCopilotStarted() {
  void start();
}
