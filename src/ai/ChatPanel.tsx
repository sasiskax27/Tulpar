// Панель чата с ИИ (Ctrl+Alt+I).
import { createEffect, createSignal, For, on, Show, type JSX } from "solid-js";
import { suggest, type MentionItem } from "./mentions";
import {
  messages, streaming, useFile, setUseFile, attached, attach, detach, newChat, stop, send,
  useProject, setUseProject, collecting, attachedDirs, agentMode, setAgentMode, type AgentStep,
  currentFileLabel, insertIntoEditor, relPath,
  loadChats, openChat, deleteChat, clearChats, currentFolder, type SavedChat, type ChatMsg,
} from "./chat";
import { core, baseName, joinPath } from "../ipc";
import { root } from "../app/workspace";
import { openFile, activePath } from "../editor/tabs";
import { monaco } from "../editor/monaco";
import { pick } from "../app/QuickPick";
import { notify } from "../app/notify";
import { settings, updateSetting } from "../config/store";
import { executeCommand } from "../commands/registry";
import { chatDrop } from "../explorer/dnd";
import { answerStep, rollbackTask, showStepDiff, undoStep } from "./agent";

let input: HTMLTextAreaElement | undefined;

// ---------- подсказки @-упоминаний ----------
const [mention, setMention] = createSignal<{ start: number; query: string } | null>(null);
const [mentionItems, setMentionItems] = createSignal<MentionItem[]>([]);
const [mentionIndex, setMentionIndex] = createSignal(0);
let mentionSeq = 0;

function updateMention(el: HTMLTextAreaElement) {
  const caret = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) {
    setMention(null);
    return;
  }
  const start = caret - m[2].length - 1;
  setMention({ start, query: m[2] });
  const my = ++mentionSeq;
  void suggest(m[2]).then((items) => {
    if (my !== mentionSeq) return;
    setMentionItems(items);
    setMentionIndex(0);
    if (!items.length) setMention(null);
  });
}

function applyMention(item: MentionItem) {
  const m = mention();
  if (!input || !m) return;
  const caret = input.selectionStart ?? input.value.length;
  const text = `@${item.insert} `;
  input.value = input.value.slice(0, m.start) + text + input.value.slice(caret);
  const pos = m.start + text.length;
  input.setSelectionRange(pos, pos);
  input.focus();
  setMention(null);
}

/** Клавиши в поле ввода, пока открыт список упоминаний. true — клавиша обработана. */
function mentionKey(e: KeyboardEvent): boolean {
  if (!mention() || !mentionItems().length) return false;
  const n = mentionItems().length;
  if (e.key === "ArrowDown") setMentionIndex((i) => (i + 1) % n);
  else if (e.key === "ArrowUp") setMentionIndex((i) => (i - 1 + n) % n);
  else if (e.key === "Enter" || e.key === "Tab") applyMention(mentionItems()[mentionIndex()]);
  else if (e.key === "Escape") setMention(null);
  else return false;
  e.preventDefault();
  return true;
}

export function focusChat(text?: string) {
  queueMicrotask(() => {
    if (input && text) input.value = text;
    input?.focus();
  });
}

// ---------- отображение ответа ----------

// «src/main.rs:12» или «main.rs:12» — ссылка на место в коде
const FILE_REF = /([\w./\\-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)/g;

function openRef(path: string, line: number) {
  const r = root();
  if (!r) return;
  const clean = path.replace(/^\.?[\\/]/, "");
  void openFile(joinPath(r, clean), new monaco.Range(line, 1, line, 1));
}

/** Строчный текст: `код`, **жирный** и ссылки файл:строка. Без innerHTML. */
function Inline(props: { text: string }) {
  const nodes: JSX.Element[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  const pushText = (t: string) => {
    let i = 0;
    for (const m of t.matchAll(FILE_REF)) {
      if (m.index! > i) nodes.push(t.slice(i, m.index));
      const [whole, file, line] = m;
      nodes.push(
        <a href="#" class="chat-ref" onClick={(e) => { e.preventDefault(); openRef(file, Number(line)); }}>
          {whole}
        </a>,
      );
      i = m.index! + whole.length;
    }
    if (i < t.length) nodes.push(t.slice(i));
  };
  for (const m of props.text.matchAll(pattern)) {
    if (m.index! > last) pushText(props.text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("`")) {
      const code = token.slice(1, -1);
      const ref = code.match(/^([\w./\\-]+\.[A-Za-z][A-Za-z0-9]*):(\d+)$/);
      nodes.push(
        ref ? (
          <a href="#" class="chat-ref" onClick={(e) => { e.preventDefault(); openRef(ref[1], Number(ref[2])); }}>
            <code>{code}</code>
          </a>
        ) : (
          <code>{code}</code>
        ),
      );
    } else {
      nodes.push(<strong>{token.slice(2, -2)}</strong>);
    }
    last = m.index! + token.length;
  }
  if (last < props.text.length) pushText(props.text.slice(last));
  return <>{nodes}</>;
}

function CodeBlock(props: { lang: string; code: string }) {
  return (
    <div class="chat-code">
      <div class="chat-code-bar">
        <span>{props.lang || "код"}</span>
        <span class="chat-code-actions">
          <button
            class="button-quiet"
            onClick={() => {
              void navigator.clipboard.writeText(props.code);
              notify("Скопировано");
            }}
          >
            Копировать
          </button>
          <button
            class="button-quiet"
            disabled={!activePath()}
            title="Вставить вместо выделения или в место курсора (Ctrl+Z — отменить)"
            onClick={() => insertIntoEditor(props.code) || notify("Откройте файл, чтобы вставить код")}
          >
            Вставить
          </button>
        </span>
      </div>
      <pre>{props.code}</pre>
    </div>
  );
}

/** Ответ ИИ: блоки ``` — отдельно, остальное — абзацами. */
export function Markdown(props: { text: string }) {
  const blocks = () => {
    const out: { kind: "text" | "code"; lang: string; body: string }[] = [];
    const re = /```([^\n`]*)\n([\s\S]*?)(```|$)/g;
    let last = 0;
    for (const m of props.text.matchAll(re)) {
      if (m.index! > last) out.push({ kind: "text", lang: "", body: props.text.slice(last, m.index) });
      out.push({ kind: "code", lang: m[1].trim(), body: m[2].replace(/\n$/, "") });
      last = m.index! + m[0].length;
    }
    if (last < props.text.length) out.push({ kind: "text", lang: "", body: props.text.slice(last) });
    return out;
  };
  return (
    <For each={blocks()}>
      {(b) =>
        b.kind === "code" ? (
          <CodeBlock lang={b.lang} code={b.body} />
        ) : (
          <For each={b.body.split(/\n{2,}/).filter((p) => p.trim())}>
            {(para) => (
              <div class="chat-para">
                <For each={para.split("\n")}>
                  {(line) => {
                    const h = line.match(/^#{1,4}\s+(.*)/);
                    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
                    if (h) return <div class="chat-h"><Inline text={h[1]} /></div>;
                    if (li) return <div class="chat-li"><span class="chat-bullet">•</span><span><Inline text={li[1]} /></span></div>;
                    return <div><Inline text={line} /></div>;
                  }}
                </For>
              </div>
            )}
          </For>
        )
      }
    </For>
  );
}

// ---------- панель ----------

const SUGGESTIONS = ["Объясни этот файл", "Найди ошибки в коде", "Как устроен этот проект?", "Напиши тесты для выделенного кода"];

/** Открыта домашняя папка целиком (C:\\Users\\имя, /home/имя), а не проект. */
function isHomeFolder(path: string | null): boolean {
  return !!path && /^(?:[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/(?:home|Users)\/[^/]+)[\\/]?$/.test(path);
}

const STEP_ICON: Record<AgentStep["status"], string> = { running: "◌", pending: "?", done: "✓", denied: "⨯", error: "!" };

function StepView(props: { step: AgentStep }) {
  const st = () => props.step;
  return (
    <div class={`agent-step ${st().status}`} classList={{ undone: st().undone }}>
      <div class="agent-step-head">
        <span class="agent-step-icon" aria-hidden="true">{STEP_ICON[st().status]}</span>
        <span class="agent-step-title">{st().title}</span>
        <Show when={st().result}>
          <span class="agent-step-result">{st().result}</span>
        </Show>
        <Show when={st().undone}>
          <span class="agent-step-result">отменено</span>
        </Show>
      </div>
      <Show when={st().detail || st().output}>
        <details class="agent-step-details" open={st().status === "pending"}>
          <summary>{st().tool === "run_command" ? (st().output ? "Команда и вывод" : "Команда") : "Подробнее"}</summary>
          <Show when={st().detail}>
            <pre class="agent-pre">{st().detail}</pre>
          </Show>
          <Show when={st().output}>
            <pre class="agent-pre output">{st().output}</pre>
          </Show>
        </details>
      </Show>
      <Show when={st().status === "pending"}>
        <div class="agent-step-actions">
          <button class="button" onClick={() => answerStep(st().id, true)}>
            {st().tool === "run_command" ? "Запустить" : "Разрешить"}
          </button>
          <button class="button-quiet" onClick={() => answerStep(st().id, false)}>Отклонить</button>
        </div>
      </Show>
      <Show when={st().status === "done" && st().undo && !st().undone}>
        <div class="agent-step-actions">
          <button class="button-quiet" onClick={() => showStepDiff(st())}>Показать изменения</button>
          <button class="button-quiet" onClick={() => void undoStep(st())}>Отменить</button>
        </div>
      </Show>
    </div>
  );
}

/** Сводная карточка задачи: какие файлы изменены, дифф и откат каждого файла. */
function CheckpointCard(props: { msg: ChatMsg }) {
  const m = () => props.msg;
  /** Последний шаг правки каждого файла — он знает прежний текст. */
  const files = () => {
    const byPath = new Map<string, { path: string; created: boolean; before: string | null; step?: AgentStep }>();
    for (const st of m().steps ?? []) {
      if (!st.undo) continue;
      byPath.set(st.undo.path, { path: st.undo.path, created: st.undo.before === null, before: st.undo.before, step: st });
    }
    for (const c of m().checkpoint ?? []) {
      if (!byPath.has(c.path)) byPath.set(c.path, { path: c.path, created: c.before === null, before: c.before });
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path, "ru"));
  };
  const changed = () => files().filter((f) => !f.step?.undone).length;

  return (
    <div class="agent-checkpoint" classList={{ done: m().rolledBack }}>
      <div class="agent-checkpoint-head">
        <span>{m().rolledBack ? "Изменения откачены" : `Изменено файлов: ${changed()}`}</span>
        <Show when={!m().rolledBack && changed() > 0}>
          <button class="button-quiet" title="Вернуть все файлы к состоянию до этой задачи" onClick={() => void rollbackTask(m())}>
            ↶ Откатить всё
          </button>
        </Show>
      </div>
      <Show when={files().length > 1 || m().rolledBack}>
        <div class="agent-checkpoint-files">
          <For each={files()}>
            {(f) => (
              <div class="agent-checkpoint-file" classList={{ undone: f.step?.undone || m().rolledBack }}>
                <span class="agent-file-kind" title={f.created ? "Файл создан задачей" : "Файл изменён"}>
                  {f.created ? "＋" : "✎"}
                </span>
                <span class="agent-file-name" title={f.path}>{relPath(f.path) || baseName(f.path)}</span>
                <Show when={!m().rolledBack && !f.step?.undone}>
                  <span class="agent-file-actions">
                    <Show when={f.step}>
                      <button class="button-quiet" title="Что именно изменилось" onClick={() => showStepDiff(f.step!)}>
                        изменения
                      </button>
                    </Show>
                    <button
                      class="button-quiet"
                      title="Вернуть файл к состоянию до задачи"
                      onClick={() => void undoStep(f.step ?? { id: f.path, tool: "edit_file", title: "", status: "done", undo: { path: f.path, before: f.before } })}
                    >
                      отменить
                    </button>
                  </span>
                </Show>
                <Show when={f.step?.undone || m().rolledBack}>
                  <span class="agent-file-undone">отменено</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Кнопка «перенести чат вниз / в боковую панель». */
export function MoveChatButton() {
  const bottom = () => settings()["tulpar.chat.location"] !== "sidebar";
  return (
    <button
      class="icon-button"
      aria-label={bottom() ? "Перенести чат в боковую панель" : "Перенести чат вниз, к терминалу"}
      title={bottom() ? "Перенести чат в боковую панель" : "Перенести чат вниз, к терминалу"}
      onClick={() => void executeCommand("tulpar.chat.moveLocation")}
    >
      <Show
        when={bottom()}
        fallback={<svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2 9.5h12" /></svg>}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11" /></svg>
      </Show>
    </button>
  );
}

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `сегодня ${time}`;
  return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} ${time}`;
}

/** История чатов: открыть прошлый разговор, удалить, очистить. */
export async function showChatHistory() {
  const chats = loadChats();
  if (!chats.length) {
    notify("История пуста — чаты сохраняются после первого ответа ИИ");
    return;
  }
  const r = root();
  // Сначала чаты этого проекта
  const sorted = [...chats].sort((a, b) => Number(b.root === r) - Number(a.root === r) || b.updated - a.updated);
  type Choice = { kind: "open" | "delete" | "clear"; chat?: SavedChat };
  const choice = await pick<Choice>(
    [
      ...sorted.map((c) => ({
        label: c.title,
        detail: `${when(c.updated)}${c.root ? " · " + baseName(c.root) : ""} · сообщений: ${c.messages.length}`,
        value: { kind: "open" as const, chat: c },
      })),
      { label: "🗑 Удалить чат из истории…", value: { kind: "delete" as const } },
      { label: "🗑 Очистить всю историю", value: { kind: "clear" as const } },
    ],
    "История чатов — начните печатать для поиска",
  );
  if (!choice) return;
  if (choice.kind === "open" && choice.chat) {
    openChat(choice.chat);
    void executeCommand("workbench.action.chat.open");
  } else if (choice.kind === "delete") {
    const target = await pick(
      sorted.map((c) => ({ label: c.title, detail: when(c.updated), value: c.id })),
      "Какой чат удалить?",
    );
    if (target) deleteChat(target);
  } else if (choice.kind === "clear") {
    clearChats();
    notify("История чатов очищена");
  }
}

/** Кнопка «OpenCode»: агент OpenCode с бесплатными облачными моделями во вкладке терминала. */
export function OpenCodeButton() {
  return (
    <button
      class="chat-opencode"
      title="Открыть OpenCode во вкладке терминала: агент для кода с бесплатными облачными моделями (работает в папке проекта)"
      onClick={() => void executeCommand("tulpar.opencode.open")}
    >
      OpenCode
    </button>
  );
}

export function HistoryButton() {
  return (
    <button class="icon-button" aria-label="История чатов" title="История чатов" onClick={() => void showChatHistory()}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3.2l2.2 1.4" /></svg>
    </button>
  );
}

export function NewChatButton() {
  return (
    <button class="icon-button" aria-label="Новый чат" title="Новый чат" onClick={newChat}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 3.5v9M3.5 8h9" /></svg>
    </button>
  );
}

const [waited, setWaited] = createSignal(0);
let waitTimer: number | undefined;

function waitingText(): string {
  const sec = Math.floor(waited() / 1000);
  const local = settings()["tulpar.ai.provider"] === "ollama" && !settings()["tulpar.ai.model"].includes("cloud");
  if (sec < 3) return "Думаю…";
  if (local) return `Модель загружается в память… ${sec} с. Следующие ответы будут быстрее.`;
  return `Жду ответ сервиса… ${sec} с`;
}

export default function ChatPanel(props: { embedded?: boolean }) {
  let list: HTMLDivElement | undefined;

  createEffect(
    on(streaming, (id) => {
      clearInterval(waitTimer);
      setWaited(0);
      if (!id) return;
      const start = Date.now();
      waitTimer = window.setInterval(() => setWaited(Date.now() - start), 500);
    }),
  );
  // Пока пишется вопрос — модель Ollama уже грузится в память
  createEffect(() => {
    settings()["tulpar.ai.model"];
    void import("./ollama").then((o) => o.warmUp());
  });

  // Прокрутка вниз по мере ответа, если пользователь сам не листает вверх
  createEffect(
    on(
      () => messages.map((m) => `${m.content.length}:${(m.steps ?? []).map((st) => st.status).join("")}`).join(","),
      () => {
        if (!list) return;
        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 200;
        // Шаг ждёт решения — прокручиваем к нему, даже если пользователь листал вверх
        const pending = messages.some((m) => m.steps?.some((st) => st.status === "pending"));
        if (nearBottom || pending) requestAnimationFrame(() => list!.scrollTo({ top: list!.scrollHeight }));
      },
    ),
  );

  const submit = () => {
    if (!input) return;
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    input.style.height = "";
    void send(text);
  };

  const addFile = async () => {
    if (!root()) return;
    const files: string[] = await core.listFiles().catch(() => []);
    const choice = await pick<string>(files.slice(0, 5000).map((f) => ({ label: f.split("/").pop()!, detail: f, value: f })), "Приложить файл к вопросу");
    if (choice) attach(joinPath(root()!, choice));
  };

  const providerOff = () => settings()["tulpar.ai.provider"] === "none";

  return (
    <div
      class="chat-panel"
      classList={{ embedded: props.embedded, "chat-drop": chatDrop() }}
      data-chat-drop="1"
    >
      <Show when={!props.embedded}>
        <div class="panel-header">
          <span>Чат с ИИ</span>
          <div class="panel-actions">
            <OpenCodeButton />
            <MoveChatButton />
            <HistoryButton />
            <NewChatButton />
          </div>
        </div>
      </Show>

      <Show when={chatDrop()}>
        <div class="chat-drop-overlay">Отпустите — приложить к вопросу</div>
      </Show>
      <div ref={list} class="chat-list" aria-live="polite">
        <Show
          when={messages.length}
          fallback={
            <div class="chat-empty">
              <Show
                when={!providerOff()}
                fallback={
                  <>
                    <p>ИИ ещё не подключён.</p>
                    <button class="button" onClick={() => void executeCommand("workbench.action.openSettings")}>
                      Открыть настройки ИИ
                    </button>
                  </>
                }
              >
                <Show
                  when={agentMode() && root()}
                  fallback={<p>Спросите что угодно о своём коде. ИИ видит открытый файл и список файлов проекта.</p>}
                >
                  <p>Дайте задачу — агент сам найдёт нужные файлы, поправит код и запустит команды. Правки и команды он покажет и спросит разрешения.</p>
                  <Show when={isHomeFolder(root())}>
                    <p class="chat-warn">
                      Сейчас открыта вся домашняя папка. Агенту будет проще и быстрее, если открыть папку конкретного проекта (Ctrl+K Ctrl+O).
                    </p>
                  </Show>
                </Show>
                <p class="chat-hint">Перетащите сюда файл или папку из проводника — они приложатся к вопросу. Перетащите имя проекта — ИИ прочитает весь проект.</p>
                <div class="chat-suggestions">
                  <For each={SUGGESTIONS}>
                    {(s) => (
                      <button class="chat-suggestion" onClick={() => void send(s)}>
                        {s}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          }
        >
          <For each={messages}>
            {(m, i) => (
              <div class={`chat-msg ${m.role}`} classList={{ error: !!m.error }}>
                <Show when={m.role === "user"} fallback={
                  <>
                    <Show when={m.steps?.length}>
                      <div class="agent-steps">
                        <For each={m.steps}>{(st) => <StepView step={st} />}</For>
                      </div>
                    </Show>
                    <Show when={m.checkpoint?.length && !(streaming() && i() === messages.length - 1)}>
                      <CheckpointCard msg={m} />
                    </Show>

                    <Show
                      when={m.content}
                      fallback={
                        <Show when={streaming() && i() === messages.length - 1}>
                          <span class="chat-typing">
                            {collecting() ?? (m.steps ? (m.steps.some((x) => x.status === "pending") ? "Жду вашего решения" : "Агент работает") : "ИИ думает")}
                            <span>.</span><span>.</span><span>.</span>
                          </span>
                        </Show>
                      }
                    >
                      <Markdown text={m.content} />
                      <Show when={streaming() && i() === messages.length - 1 && !m.content && !m.steps}>
                        <div class="chat-waiting">{waitingText()}</div>
                      </Show>
                      <Show when={!streaming() || i() !== messages.length - 1}>
                        <Show when={m.stats}>
                          <div class="chat-stats" data-no-translate>{m.stats}</div>
                        </Show>
                      </Show>
                      <Show when={streaming() && i() === messages.length - 1}>
                        <Show when={m.steps} fallback={<span class="chat-cursor" />}>
                          <div class="chat-typing">Агент работает<span>.</span><span>.</span><span>.</span></div>
                        </Show>
                      </Show>
                    </Show>
                  </>
                }>
                  <div class="chat-user-text">{m.content}</div>
                  <Show when={m.context?.length}>
                    <div class="chat-context">📎 {m.context!.join(", ")}</div>
                  </Show>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>

      <div class="chat-input-area">
        <div class="chat-chips">
          <Show when={currentFileLabel()}>
            <button
              class="chat-chip"
              classList={{ off: !useFile() }}
              title={useFile() ? "Открытый файл приложится к вопросу. Нажмите, чтобы не прикладывать" : "Нажмите, чтобы приложить открытый файл"}
              onClick={() => setUseFile(!useFile())}
            >
              {useFile() ? "📎" : "○"} {currentFileLabel()}
            </button>
          </Show>
          <Show when={agentMode() && root() && currentFolder()}>
            <span class="chat-chip folder" title="Агент создаёт новые файлы здесь. Выберите другую папку в проводнике, чтобы сменить">
              📂 {currentFolder() === "." ? baseName(root()!) : currentFolder()}
            </span>
          </Show>
          <For each={attached()}>
            {(p) => (
              <button class="chat-chip" title={`${relPath(p)} — нажмите, чтобы убрать`} onClick={() => detach(p)}>
                {attachedDirs().includes(p) ? "📁" : "📎"} {baseName(p)} ×
              </button>
            )}
          </For>
          <Show when={root()}>
            <button
              class="chat-chip"
              classList={{ off: !useProject() }}
              title={useProject()
                ? "ИИ прочитает файлы проекта. Если не помещаются — возьмёт самые подходящие к вопросу. Нажмите, чтобы выключить"
                : "Дать ИИ прочитать весь проект"}
              onClick={() => setUseProject(!useProject())}
            >
              {useProject() ? "🗂" : "○"} Весь проект
            </button>
            <button class="chat-chip add" onClick={() => void addFile()}>+ файл</button>
            <button
              class="chat-chip agent"
              classList={{ on: agentMode() }}
              title={agentMode()
                ? "Агент: ИИ сам читает файлы, правит код и запускает команды. Нажмите, чтобы просто спрашивать"
                : "Включить агента: ИИ будет сам выполнять задачи в проекте"}
              onClick={() => setAgentMode(!agentMode())}
            >
              {agentMode() ? "🤖 Агент" : "💬 Вопрос"}
            </button>
            <Show when={agentMode()}>
              <button
                class="chat-chip auto"
                classList={{ on: settings()["tulpar.agent.approve"] === "all" }}
                title={settings()["tulpar.agent.approve"] === "all"
                  ? "Авто: агент сам правит файлы и запускает команды без вопросов (опасные команды всё равно спросит). Нажмите, чтобы спрашивать"
                  : "Включить авто: агент будет всё делать сам, без вопросов. Правки останутся подсвечены в редакторе — их можно отменить"}
                onClick={() => updateSetting("tulpar.agent.approve", settings()["tulpar.agent.approve"] === "all" ? "ask" : "all")}
              >
                ⚡ Авто
              </button>
            </Show>
          </Show>
        </div>
        <div class="chat-box">
          <Show when={mention() && mentionItems().length}>
            <div class="mention-popup" role="listbox" aria-label="Упоминания">
              <For each={mentionItems()}>
                {(item, i) => (
                  <button
                    class="mention-item"
                    classList={{ on: i() === mentionIndex(), special: item.kind === "special" }}
                    role="option"
                    aria-selected={i() === mentionIndex()}
                    onMouseDown={(e) => (e.preventDefault(), applyMention(item))}
                    onMouseEnter={() => setMentionIndex(i())}
                  >
                    <span class="mention-label" data-no-translate={item.kind === "file" ? "" : undefined}>
                      {item.label}
                    </span>
                    <span class="mention-hint" data-no-translate={item.kind === "file" ? "" : undefined}>
                      {item.hint}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <textarea
            ref={input}
            class="chat-input"
            rows={1}
            placeholder={agentMode() && root()
              ? "Задача для агента: «добавь проверку ввода», «почини тесты»… (Enter)"
              : "Спросить ИИ… @ — файл, терминал, ошибки (Enter — отправить)"}
            aria-label="Вопрос ИИ"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 200) + "px";
              updateMention(el);
            }}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            onKeyDown={(e) => {
              if (mentionKey(e)) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Show
            when={streaming()}
            fallback={
              <button class="chat-send" aria-label="Отправить" title="Отправить (Enter)" onClick={submit}>
                <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2 2.5 14.5 8 2 13.5 3.8 8z" /></svg>
              </button>
            }
          >
            <button class="chat-send stop" aria-label="Остановить" title="Остановить ответ" onClick={() => void stop()}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}
