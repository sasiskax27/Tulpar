// Типизированные вызовы ядра на Rust. Интерфейс не трогает диск сам — только через эти функции.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ChangeEvent {
  kind: "create" | "modify" | "remove";
  paths: string[];
}

export type ConfigName = "settings.json" | "keybindings.json" | "layout.json" | "languages.json" | "snippets.json";

export interface UpdateInfo {
  current: string;
  version: string;
  page: string;
  notes: string;
  assetUrl: string | null;
  assetName: string | null;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface AgentStepRequest {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  messages: AgentMessage[];
  tools: { name: string; description: string; parameters: unknown }[];
  contextSize?: number;
}

export interface AgentReply {
  text: string;
  toolCalls: ToolCall[];
}

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
}

export interface SearchMatch {
  line: number;
  startCol: number;
  endCol: number;
  before: string;
  text: string;
  after: string;
}

export interface SearchResult {
  files: { path: string; rel: string; matches: SearchMatch[] }[];
  total: number;
  truncated: boolean;
}

export interface GitFile {
  path: string;
  abs: string;
  index: string;
  work: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export interface AiRequest {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
}

export const core = {
  workspaceOpen: (path: string) => invoke<string>("workspace_open", { path }),
  workspaceRoot: () => invoke<string | null>("workspace_root"),
  readDir: (path: string) => invoke<DirEntry[]>("read_dir", { path }),
  readFile: (path: string) => invoke<string>("read_file", { path }),
  writeFile: (path: string, content: string) => invoke<void>("write_file", { path, content }),
  listFiles: () => invoke<string[]>("list_files"),
  configRead: (name: ConfigName) => invoke<string | null>("config_read", { name }),
  configDir: () => invoke<string>("config_dir"),
  lspStart: (command: string, args: string[], cwd: string | null) =>
    invoke<number>("lsp_start", { command, args, cwd }),
  lspSend: (id: number, message: string) => invoke<void>("lsp_send", { id, message }),
  lspStop: (id: number) => invoke<void>("lsp_stop", { id }),
  terminalStart: (id: string, shell: string | null, cwd: string | null, cols: number, rows: number) =>
    invoke<string>("terminal_start", { id, shell, cwd, cols, rows }),
  terminalWrite: (id: string, data: string) => invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows }),
  terminalKill: (id: string) => invoke<void>("terminal_kill", { id }),
  terminalReset: () => invoke<void>("terminal_reset"),
  backgroundImport: (path: string) => invoke<string>("background_import", { path }),
  imageRead: (path: string) => invoke<{ mime: string; base64: string }>("image_read", { path }),
  aiComplete: (request: AiRequest) => invoke<string>("ai_complete", { request }),
  systemMemory: () => invoke<{ ramGb: number | null; vramGb: number | null }>("system_memory"),
  ollamaStatus: (host: string) =>
    invoke<{ running: boolean; models: { name: string; size: number }[] }>("ollama_status", { host }),
  ollamaPull: (host: string, model: string) => invoke<void>("ollama_pull", { host, model }),
  ollamaDelete: (host: string, model: string) => invoke<void>("ollama_delete", { host, model }),
  createFile: (path: string) => invoke<string>("create_file", { path }),
  userFileWrite: (path: string, content: string) => invoke<void>("user_file_write", { path, content }),
  userFileSaveBinary: (path: string, data: Uint8Array) =>
    invoke<void>("user_file_save_binary", data, { headers: { "x-path": encodeURIComponent(path) } }),
  userFileRead: (path: string) => invoke<string>("user_file_read", { path }),
  projectCreate: (parent: string, name: string) => invoke<string>("project_create", { parent, name }),
  createDir: (path: string) => invoke<string>("create_dir", { path }),
  renamePath: (from: string, to: string) => invoke<string>("rename_path", { from, to }),
  deletePath: (path: string) => invoke<void>("delete_path", { path }),
  searchProject: (options: SearchOptions) => invoke<SearchResult>("search_project", { options }),
  replaceInFile: (path: string, options: SearchOptions, replacement: string) =>
    invoke<number>("replace_in_file", { path, options, replacement }),
  transferPaths: (sources: string[], targetDir: string, mode: "copy" | "move") =>
    invoke<string[]>("transfer_paths", { sources, targetDir, mode }),
  gitStatus: () => invoke<GitStatus>("git_status"),
  gitBlameLine: (path: string, line: number, content?: string) =>
    invoke<{ author: string; time: number; summary: string; hash: string; uncommitted: boolean } | null>("git_blame_line", { path, line, content }),
  gitLog: (path?: string, limit?: number) =>
    invoke<{ hash: string; author: string; time: number; subject: string; refs: string }[]>("git_log", { path, limit }),
  gitShowCommit: (hash: string) => invoke<string>("git_show_commit", { hash }),
  gitShowHead: (path: string) => invoke<string>("git_show_head", { path }),
  gitStage: (paths: string[]) => invoke<void>("git_stage", { paths }),
  gitUnstage: (paths: string[]) => invoke<void>("git_unstage", { paths }),
  gitDiscard: (paths: string[]) => invoke<void>("git_discard", { paths }),
  gitCommit: (message: string, all: boolean) => invoke<void>("git_commit", { message, all }),
  gitInit: () => invoke<void>("git_init"),
  gitBranches: () => invoke<string[]>("git_branches"),
  gitCheckout: (branch: string, create: boolean) => invoke<void>("git_checkout", { branch, create }),
  gitSync: (action: "push" | "pull" | "fetch") => invoke<string>("git_sync", { action }),
  gitDiffForMessage: () => invoke<string>("git_diff_for_message"),
  aiFill: (request: { host: string; model: string; prefix: string; suffix: string; maxTokens: number }) =>
    invoke<string>("ai_fill", { request }),
  aiModels: (provider: string, baseUrl: string, apiKey: string) =>
    invoke<{ id: string; free: boolean }[]>("ai_models", { provider, baseUrl, apiKey }),
  updateCheck: () => invoke<UpdateInfo | null>("update_check"),
  testsRun: (command: string, reportExt?: string) =>
    invoke<{ code: number | null; output: string; report: string | null; timedOut: boolean; millis: number }>("tests_run", { command, reportExt: reportExt ?? null }),
  testsJunitReports: (dirs: string[]) => invoke<string[]>("tests_junit_reports", { dirs }),
  sqliteTables: (path: string) => invoke<SqliteTable[]>("sqlite_tables", { path }),
  sqliteQuery: (path: string, sql: string, write = false) => invoke<SqliteResult>("sqlite_query", { path, sql, write }),
  dbQuery: (kind: string, url: string, sql: string) => invoke<SqliteResult>("db_query", { kind, url, sql }),
  dbTables: (kind: string, url: string) => invoke<DbObject[]>("db_tables", { kind, url }),
  mongoCollections: (url: string) => invoke<DbObject[]>("mongo_collections", { url }),
  mongoFind: (url: string, db: string, collection: string, filter: string, limit?: number) =>
    invoke<SqliteResult>("mongo_find", { url, db, collection, filter, limit: limit ?? null }),
  pkgSearch: (registry: string, query: string) => invoke<PkgItem[]>("pkg_search", { registry, query }),
  extSearch: (query: string, category?: string) => invoke<ExtSearchItem[]>("ext_search", { query, category: category ?? null }),
  extInstall: (namespace: string, name: string) => invoke<InstalledExt>("ext_install", { namespace, name }),
  extList: () => invoke<InstalledExt[]>("ext_list"),
  extRead: (id: string, file: string) => invoke<string>("ext_read", { id, file }),
  extUninstall: (id: string) => invoke<void>("ext_uninstall", { id }),
  updateInstall: (url: string, name: string) => invoke<void>("update_install", { url, name }),
  updateOpenPage: (url: string) => invoke<void>("update_open_page", { url }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  aiAgentStep: (request: AgentStepRequest) => invoke<AgentReply>("ai_agent_step", { request }),
  agentWrite: (path: string, content: string) => invoke<string>("agent_write", { path, content }),
  agentRun: (command: string, timeoutSecs?: number) =>
    invoke<{ code: number | null; output: string; timedOut: boolean }>("agent_run", { command, timeoutSecs }),
  aiChat: (request: { id: string; provider: string; baseUrl: string; model: string; apiKey: string; system: string; messages: { role: string; content: string }[]; contextSize?: number }) =>
    invoke<string>("ai_chat", { request }),
  aiChatCancel: (id: string) => invoke<void>("ai_chat_cancel", { id }),
  backupPut: (name: string, data: string) => invoke<void>("backup_put", { name, data }),
  backupDelete: (name: string) => invoke<void>("backup_delete", { name }),
  backupList: () => invoke<[string, string][]>("backup_list"),
  configEnsure: (name: ConfigName) => invoke<string>("config_ensure", { name }),
};

export const events = {
  onWorkspaceChanged: (cb: (e: ChangeEvent) => void): Promise<UnlistenFn> =>
    listen<ChangeEvent>("workspace:changed", (e) => cb(e.payload)),
  onLspMessage: (cb: (id: number, message: string) => void): Promise<UnlistenFn> =>
    listen<{ id: number; message: string }>("lsp:message", (e) => cb(e.payload.id, e.payload.message)),
  onLspExit: (cb: (id: number, stderr: string) => void): Promise<UnlistenFn> =>
    listen<{ id: number; stderr: string }>("lsp:exit", (e) => cb(e.payload.id, e.payload.stderr ?? "")),
  onTerminalData: (cb: (id: string, data: string) => void): Promise<UnlistenFn> =>
    listen<{ id: string; data: string }>("terminal:data", (e) => cb(e.payload.id, e.payload.data)),
  onTerminalExit: (cb: (id: string) => void): Promise<UnlistenFn> =>
    listen<{ id: string }>("terminal:exit", (e) => cb(e.payload.id)),
  onOllamaProgress: (cb: (p: { model: string; status: string; completed: number; total: number }) => void): Promise<UnlistenFn> =>
    listen<{ model: string; status: string; completed: number; total: number }>("ollama:progress", (e) => cb(e.payload)),
  onAiChunk: (cb: (id: string, text: string) => void): Promise<UnlistenFn> =>
    listen<{ id: string; text: string }>("ai:chunk", (e) => cb(e.payload.id, e.payload.text)),
  onConfigChanged: (cb: (name: ConfigName) => void): Promise<UnlistenFn> =>
    listen<{ name: ConfigName }>("config:changed", (e) => cb(e.payload.name)),
};

/** Соединяет корень и относительный путь с правильным разделителем для ОС. */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
}

/** Папка, в которой лежит файл или папка. */
export function parentDir(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

/** Разделитель путей, принятый в этом пути. */
export function sepOf(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

/** Имя файла из полного пути. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface ExtSearchItem {
  namespace: string;
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  downloads?: number;
  icon?: string;
}

export interface InstalledExt {
  id: string;
  displayName: string;
  version: string;
  description: string;
  themes: { label: string; uiTheme: string; file: string }[];
  snippets: { language: string; file: string }[];
}

export interface PkgItem {
  name: string;
  version: string;
  description: string;
  downloads?: number | null;
  /** Maven: group:artifact */
  id: string;
}

export interface SqliteTable {
  name: string;
  kind: "table" | "view";
  rows: number | null;
  columns: { name: string; type: string; pk: boolean; notNull: boolean }[];
}

export interface SqliteResult {
  columns: string[];
  rows: (string | number | null)[][];
  truncated: boolean;
  changes: number | null;
  millis: number;
}

export interface DbObject {
  schema: string;
  name: string;
  kind: "table" | "view" | "collection";
}
