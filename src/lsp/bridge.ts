// Мост Monaco ↔ LSP: регистрирует провайдеры Monaco (автодополнение, подсказки,
// переход к определению…), каждый из которых превращается в запрос к языковому серверу.
import { monaco } from "../editor/monaco";
import { loadModel, openFile } from "../editor/tabs";
import { clientFor } from "./manager";
import type { LspClient } from "./client";
import {
  toCompletionKind, toDocumentation, toLocations, toLspPosition, toMarkdown,
  toRange, toTextEdit, type LspTextEdit,
} from "./convert";

const registered = new Set<string>();

function doc(model: monaco.editor.ITextModel) {
  return { uri: model.uri.toString() };
}

/** Убедиться, что файлы из ответа сервера загружены в модели — иначе Monaco
 *  не сможет показать их в «просмотре определения» и при переименовании. */
async function loadTargets(uris: string[]) {
  const unique = [...new Set(uris)];
  await Promise.all(
    unique.map((u) => {
      const uri = monaco.Uri.parse(u);
      return monaco.editor.getModel(uri) ? undefined : loadModel(uri.fsPath);
    }),
  );
}

async function toMonacoLocations(result: unknown): Promise<monaco.languages.Location[]> {
  const locations = toLocations(result);
  await loadTargets(locations.map((l) => l.uri));
  return locations.map((l) => ({ uri: monaco.Uri.parse(l.uri), range: toRange(l.range) }));
}

let openerInstalled = false;

function installOpener() {
  if (openerInstalled) return;
  openerInstalled = true;
  // Переход к определению в другом файле: открываем вкладку и выделяем место
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      let range: monaco.IRange | undefined;
      if (selectionOrPosition && "startLineNumber" in selectionOrPosition) range = selectionOrPosition;
      else if (selectionOrPosition) range = monaco.Range.fromPositions(selectionOrPosition);
      void openFile(resource.fsPath, range);
      return true;
    },
  });
}

/** Зарегистрировать провайдеры для языка — один раз. Каждый провайдер при вызове
 *  находит клиент документа и проверяет, умеет ли сервер нужное. */
export function ensureProviders(languageId: string, client: LspClient) {
  if (registered.has(languageId)) return;
  registered.add(languageId);
  installOpener();
  const caps = client.capabilities;
  const L = monaco.languages;

  L.registerCompletionItemProvider(languageId, {
    triggerCharacters: caps.completionProvider?.triggerCharacters ?? [],
    async provideCompletionItems(model, position, context) {
      const c = clientFor(model);
      if (!c?.capabilities.completionProvider) return { suggestions: [] };
      const res: any = await c.request("textDocument/completion", {
        textDocument: doc(model),
        position: toLspPosition(position),
        context: {
          triggerKind: context.triggerKind === L.CompletionTriggerKind.TriggerCharacter ? 2 : 1,
          triggerCharacter: context.triggerCharacter,
        },
      });
      const items: any[] = Array.isArray(res) ? res : res?.items ?? [];
      const word = model.getWordUntilPosition(position);
      const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const suggestions = items.map((item): monaco.languages.CompletionItem => {
        let range: monaco.IRange | monaco.languages.CompletionItemRanges = fallback;
        let insertText: string = item.insertText ?? item.label;
        if (item.textEdit) {
          insertText = item.textEdit.newText;
          range = "range" in item.textEdit
            ? toRange(item.textEdit.range)
            : { insert: toRange(item.textEdit.insert), replace: toRange(item.textEdit.replace) };
        }
        return {
          label: item.labelDetails
            ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description }
            : item.label,
          kind: toCompletionKind(item.kind),
          detail: item.detail,
          documentation: toDocumentation(item.documentation),
          insertText,
          insertTextRules: item.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range,
          sortText: item.sortText,
          filterText: item.filterText,
          preselect: item.preselect,
          commitCharacters: item.commitCharacters,
          // Автоимпорт: сервер добавляет строку import вверху файла
          additionalTextEdits: (item.additionalTextEdits ?? []).map((e: LspTextEdit) => toTextEdit(e)),
        };
      });
      return { suggestions, incomplete: !Array.isArray(res) && !!res?.isIncomplete };
    },
  });

  L.registerHoverProvider(languageId, {
    async provideHover(model, position) {
      const c = clientFor(model);
      if (!c?.capabilities.hoverProvider) return null;
      const res: any = await c.request("textDocument/hover", { textDocument: doc(model), position: toLspPosition(position) });
      if (!res) return null;
      const contents = toMarkdown(res.contents);
      return contents.length ? { contents, range: res.range ? toRange(res.range) : undefined } : null;
    },
  });

  L.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: caps.signatureHelpProvider?.triggerCharacters ?? ["(", ","],
    signatureHelpRetriggerCharacters: caps.signatureHelpProvider?.retriggerCharacters ?? [],
    async provideSignatureHelp(model, position) {
      const c = clientFor(model);
      if (!c?.capabilities.signatureHelpProvider) return null;
      const res: any = await c.request("textDocument/signatureHelp", { textDocument: doc(model), position: toLspPosition(position) });
      if (!res?.signatures?.length) return null;
      return {
        value: {
          signatures: res.signatures.map((s: any) => ({
            label: s.label,
            documentation: toDocumentation(s.documentation),
            parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: toDocumentation(p.documentation) })),
          })),
          activeSignature: res.activeSignature ?? 0,
          activeParameter: res.activeParameter ?? res.signatures[res.activeSignature ?? 0]?.activeParameter ?? 0,
        },
        dispose() {},
      };
    },
  });

  L.registerDefinitionProvider(languageId, {
    async provideDefinition(model, position) {
      const c = clientFor(model);
      if (!c?.capabilities.definitionProvider) return null;
      const res = await c.request("textDocument/definition", { textDocument: doc(model), position: toLspPosition(position) });
      return toMonacoLocations(res);
    },
  });

  L.registerReferenceProvider(languageId, {
    async provideReferences(model, position, context) {
      const c = clientFor(model);
      if (!c?.capabilities.referencesProvider) return null;
      const res = await c.request("textDocument/references", {
        textDocument: doc(model),
        position: toLspPosition(position),
        context: { includeDeclaration: context.includeDeclaration },
      });
      return toMonacoLocations(res);
    },
  });

  L.registerRenameProvider(languageId, {
    async provideRenameEdits(model, position, newName) {
      const c = clientFor(model);
      if (!c?.capabilities.renameProvider) return { edits: [], rejectReason: "Сервер не умеет переименовывать" };
      const res: any = await c.request("textDocument/rename", { textDocument: doc(model), position: toLspPosition(position), newName });
      if (!res) return { edits: [] };
      const byUri: [string, LspTextEdit[]][] = [];
      if (res.changes) byUri.push(...(Object.entries(res.changes) as [string, LspTextEdit[]][]));
      for (const dc of res.documentChanges ?? []) {
        if (dc.textDocument && dc.edits) byUri.push([dc.textDocument.uri, dc.edits]);
      }
      await loadTargets(byUri.map(([u]) => u));
      return {
        edits: byUri.flatMap(([u, edits]) =>
          edits.map((e) => ({ resource: monaco.Uri.parse(u), textEdit: toTextEdit(e), versionId: undefined })),
        ),
      };
    },
  });

  L.registerDocumentFormattingEditProvider(languageId, {
    async provideDocumentFormattingEdits(model, options) {
      const c = clientFor(model);
      if (!c?.capabilities.documentFormattingProvider) return [];
      const res: LspTextEdit[] | null = await c.request("textDocument/formatting", {
        textDocument: doc(model),
        options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
      });
      return (res ?? []).map(toTextEdit);
    },
  });
}
