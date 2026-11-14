// Панель чата с ИИ (Ctrl+Alt+I).
import { createEffect, For, on, Show, type JSX } from "solid-js";
import {
  messages, streaming, useFile, setUseFile, attached, attach, detach, newChat, stop, send,
  useProject, setUseProject, collecting, attachedDirs, agentMode, setAgentMode, type AgentStep,
  currentFileLabel, insertIntoEditor, relPath,
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
import { answerStep, showStepDiff, undoStep } from "./agent";

let input: HTMLTextAreaElement | undefined;

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
function Markdown(props: { text: string }) {
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

export function NewChatButton() {
  return (
    <button class="icon-button" aria-label="Новый чат" title="Новый чат" onClick={newChat}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 3.5v9M3.5 8h9" /></svg>
    </button>
  );
}

export default function ChatPanel(props: { embedded?: boolean }) {
  let list: HTMLDivElement | undefined;

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
            <MoveChatButton />
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
          <textarea
            ref={input}
            class="chat-input"
            rows={1}
            placeholder={agentMode() && root()
              ? "Задача для агента: «добавь проверку ввода», «почини тесты»… (Enter)"
              : "Спросить ИИ… (Enter — отправить, Shift+Enter — новая строка)"}
            aria-label="Вопрос ИИ"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 200) + "px";
            }}
            onKeyDown={(e) => {
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
