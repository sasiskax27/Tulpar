// Панель git (Ctrl+Shift+G): изменения, коммит, ветки, отправка и получение.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import {
  status, busy, message, setMessage, refresh, stage, unstage, discard, commit, sync, init,
  switchBranch, showDiff, suggestMessage, stagedFiles, changedFiles, headVersion,
} from "./git";
import { root } from "../app/workspace";
import { identity, github, checkAccount, setupIdentity, signInGithub, cloneRepo, publishToGithub } from "./account";
import { openFile } from "../editor/tabs";
import { executeCommand } from "../commands/registry";
import { showContextMenu } from "../app/ContextMenu";
import { baseName, core, joinPath, type GitFile } from "../ipc";
import { showText } from "../editor/side";
import { ago } from "./blame";
import { findings, reviewing, aiSummary, reviewChanges, clearReview } from "./review";

const LETTER: Record<string, { text: string; title: string; cls: string }> = {
  M: { text: "M", title: "Изменён", cls: "mod" },
  A: { text: "A", title: "Добавлен", cls: "add" },
  D: { text: "D", title: "Удалён", cls: "del" },
  R: { text: "R", title: "Переименован", cls: "add" },
  C: { text: "C", title: "Скопирован", cls: "add" },
  "?": { text: "U", title: "Новый, не отслеживается", cls: "add" },
  U: { text: "!", title: "Конфликт", cls: "del" },
};

function Icon(props: { label: string; onClick: () => void; children?: JSX.Element; disabled?: boolean }) {
  return (
    <button
      class="icon-button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

function FileRow(props: { file: GitFile; staged: boolean }) {
  const letter = () => LETTER[props.staged ? props.file.index : props.file.work] ?? LETTER.M;
  const dir = () => (props.file.path.includes("/") ? props.file.path.slice(0, props.file.path.lastIndexOf("/")) : "");
  const deleted = () => (props.staged ? props.file.index : props.file.work) === "D";
  const menu = (e: MouseEvent) =>
    showContextMenu(e, [
      { label: "Показать разницу", run: () => void showDiff(props.file) },
      ...(deleted() ? [] : [{ label: "Открыть файл", run: () => void openFile(props.file.abs) }]),
      "-",
      props.staged
        ? { label: "Убрать из подготовленных", run: () => void unstage([props.file.abs]) }
        : { label: "Подготовить к коммиту", run: () => void stage([props.file.abs]) },
      ...(props.staged ? [] : ["-" as const, { label: "Откатить изменения", danger: true, run: () => void discard([props.file]) }]),
    ]);
  return (
    <div class="git-file" onClick={() => void showDiff(props.file)} onContextMenu={menu} title={props.file.path}>
      <span class="git-file-name" classList={{ deleted: deleted() }}>{baseName(props.file.abs)}</span>
      <span class="git-file-dir">{dir()}</span>
      <span class="git-file-actions">
        <Show when={!deleted()}>
          <Icon label="Открыть файл" onClick={() => void openFile(props.file.abs)}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5z" /><path d="M9 1.5v4h4" /></svg>
          </Icon>
        </Show>
        <Show when={!props.staged}>
          <Icon label="Откатить изменения" onClick={() => void discard([props.file])}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 6h7a3.5 3.5 0 0 1 0 7H6M3 6l3-3M3 6l3 3" /></svg>
          </Icon>
        </Show>
        <Icon
          label={props.staged ? "Убрать из подготовленных" : "Подготовить к коммиту"}
          onClick={() => void (props.staged ? unstage([props.file.abs]) : stage([props.file.abs]))}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
            {props.staged ? <path d="M3.5 8h9" /> : <path d="M8 3.5v9M3.5 8h9" />}
          </svg>
        </Icon>
      </span>
      <span class={`git-letter ${letter().cls}`} title={letter().title}>{letter().text}</span>
    </div>
  );
}

function Section(props: { title: string; files: GitFile[]; staged: boolean }) {
  return (
    <Show when={props.files.length}>
      <div class="git-section">
        <div class="git-section-header">
          <span>{props.title}</span>
          <span class="git-section-actions">
            <Show when={!props.staged}>
              <Icon label="Откатить всё" onClick={() => void discard(props.files)}>
                <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 6h7a3.5 3.5 0 0 1 0 7H6M3 6l3-3M3 6l3 3" /></svg>
              </Icon>
            </Show>
            <Icon
              label={props.staged ? "Убрать всё из подготовленных" : "Подготовить всё"}
              onClick={() => void (props.staged ? unstage(props.files.map((f) => f.abs)) : stage(props.files.map((f) => f.abs)))}
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
                {props.staged ? <path d="M3.5 8h9" /> : <path d="M8 3.5v9M3.5 8h9" />}
              </svg>
            </Icon>
            <span class="search-count">{props.files.length}</span>
          </span>
        </div>
        <For each={props.files}>{(f) => <FileRow file={f} staged={props.staged} />}</For>
      </div>
    </Show>
  );
}

type Commit = { hash: string; author: string; time: number; subject: string; refs: string };

/** История коммитов: клик — изменения коммита справа. */
function History() {
  const [open, setOpen] = createSignal(false);
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const load = async () => setCommits(await core.gitLog(undefined, 200).catch(() => []));
  createEffect(on([open, headVersion], ([o]) => o && void load()));
  return (
    <div class="git-history">
      <button class="git-section-header git-history-head" onClick={() => setOpen(!open())}>
        <span>{open() ? "▾" : "▸"} История коммитов</span>
      </button>
      <Show when={open()}>
        <Show when={commits().length} fallback={<div class="git-clean">Коммитов пока нет</div>}>
          <For each={commits()}>
            {(c) => (
              <button
                class="git-commit-item"
                title={`${c.hash.slice(0, 8)} · ${c.author}`}
                onClick={async () => {
                  const text = await core.gitShowCommit(c.hash).catch((e) => String(e));
                  showText(`${c.hash.slice(0, 7)} · ${c.subject}`, text, "diff");
                }}
              >
                <span class="git-commit-subject">
                  <Show when={c.refs}>
                    <span class="git-commit-refs">{c.refs.replace("HEAD -> ", "")}</span>
                  </Show>
                  {c.subject}
                </span>
                <span class="git-commit-meta">
                  {c.author} · {ago(c.time)}
                </span>
              </button>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

function AccountBar() {
  return (
    <div class="git-account">
      <Show when={identity() && (!identity()!.name || !identity()!.email)}>
        <div class="git-warn">
          <span>Git не знает, кто вы — коммиты не получатся.</span>
          <button class="button" onClick={() => void setupIdentity()}>Указать имя и почту</button>
        </div>
      </Show>
      <div class="git-account-row">
        <Show
          when={github()?.user}
          fallback={
            <button class="button-quiet" onClick={() => void signInGithub()} title="Чтобы push и pull работали без пароля">
              Войти в GitHub
            </button>
          }
        >
          <span class="git-user" title="Вы вошли в GitHub">● {github()!.user}</span>
        </Show>
        <Show when={identity()?.name}>
          <button class="button-quiet git-identity" onClick={() => void setupIdentity()} title="Имя и почта в коммитах">
            {identity()!.name}
          </button>
        </Show>
        <Show when={status()?.isRepo && !status()?.upstream}>
          <button class="button-quiet" onClick={() => void publishToGithub()}>Опубликовать на GitHub</button>
        </Show>
      </div>
    </div>
  );
}

export default function GitPanel() {
  onMount(() => {
    void checkAccount();
    void refresh();
    // Пока панель открыта — подхватываем коммиты из терминала
    const t = window.setInterval(() => void refresh(), 5000);
    onCleanup(() => clearInterval(t));
  });

  const commitLabel = () => (stagedFiles().length ? "Закоммитить" : "Закоммитить всё");

  return (
    <div class="git-panel">
      <div class="panel-header">
        <span>Git</span>
        <Show when={status()?.isRepo}>
          <div class="panel-actions">
            <Icon label="Проверить обновления (fetch)" onClick={() => void sync("fetch")} disabled={!!busy()}>
              <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" /></svg>
            </Icon>
          </div>
        </Show>
      </div>

      <Show
        when={root()}
        fallback={
          <div class="explorer-empty">
            <p>Откройте папку проекта</p>
            <button class="button" onClick={() => void executeCommand("workbench.action.files.openFolder")}>
              Открыть папку
            </button>
          </div>
        }
      >
        <Show
          when={status()?.isRepo}
          fallback={
            <div class="explorer-empty">
              <p>{status() ? "Эта папка — не репозиторий git." : "Проверяю git…"}</p>
              <Show when={status()}>
                <button class="button" onClick={() => void init()}>
                  Создать репозиторий
                </button>
                <button class="button-quiet" onClick={() => void cloneRepo()}>
                  Клонировать с GitHub…
                </button>
              </Show>
              <AccountBar />
            </div>
          }
        >
          <AccountBar />
          <div class="git-branch-row">
            <button class="git-branch" onClick={() => void switchBranch()} title="Переключить ветку">
              <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 3-4 2.5-7 4.5" /></svg>
              <span>{status()?.branch ?? "без ветки"}</span>
              <span class="git-caret">▾</span>
            </button>
            <div class="git-sync">
              <button class="git-sync-btn" title="Получить (pull)" disabled={!!busy()} onClick={() => void sync("pull")}>
                ↓ {status()?.behind || ""}
              </button>
              <button class="git-sync-btn" title="Отправить (push)" disabled={!!busy()} onClick={() => void sync("push")}>
                ↑ {status()?.ahead || ""}
              </button>
            </div>
          </div>

          <div class="git-commit">
            <textarea
              class="git-message"
              placeholder="Сообщение коммита (Ctrl+Enter — закоммитить)"
              aria-label="Сообщение коммита"
              rows={3}
              value={message()}
              onInput={(e) => setMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
            />
            <div class="git-commit-row">
              <button class="button git-commit-btn" disabled={!!busy() || !message().trim()} onClick={() => void commit()}>
                {commitLabel()}
              </button>
              <button class="button-quiet git-ai-btn" disabled={!!busy()} onClick={() => void suggestMessage()} title="ИИ напишет сообщение по изменениям">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
                ИИ
              </button>
              <button
                class="button-quiet git-ai-btn"
                disabled={!!busy() || reviewing()}
                onClick={() => void reviewChanges()}
                title="Проверить изменения перед коммитом: ключи и пароли в коде, забытая отладка, баги (с ИИ, если он подключён)"
              >
                {reviewing() ? "…" : "🔍"} Проверить
              </button>
            </div>
            <Show when={busy()}>
              <div class="git-busy">{busy()}…</div>
            </Show>
            <Show when={findings()}>
              {(list) => (
                <div class="git-review">
                  <div class="git-review-head">
                    <span>
                      {reviewing()
                        ? "Проверяю…"
                        : list().length
                          ? `Найдено: ${list().length}`
                          : "Проблем не найдено ✓"}
                    </span>
                    <button class="icon-button" title="Скрыть" aria-label="Скрыть" onClick={clearReview}>
                      ✕
                    </button>
                  </div>
                  <For each={list()}>
                    {(f) => (
                      <button
                        class={`git-finding ${f.severity}`}
                        title={f.source === "ai" ? "Нашёл ИИ" : "Быстрая проверка"}
                        onClick={() => {
                          const r = root();
                          if (r) void openFile(joinPath(r, f.file), { startLineNumber: f.line, startColumn: 1, endLineNumber: f.line, endColumn: 1 });
                        }}
                      >
                        <span class="git-finding-icon">{f.severity === "error" ? "⛔" : f.severity === "warning" ? "⚠" : "ℹ"}</span>
                        <span class="git-finding-text">
                          <span class="git-finding-msg">{f.message}</span>
                          <span class="git-finding-loc" data-no-translate>
                            {f.file}:{f.line}
                            {f.source === "ai" ? " · ✦" : ""}
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                  <Show when={aiSummary()}>
                    <div class="git-review-summary">✦ {aiSummary()}</div>
                  </Show>
                </div>
              )}
            </Show>
          </div>

          <div class="git-files">
            <Section title="Подготовлено" files={stagedFiles()} staged={true} />
            <Section title="Изменения" files={changedFiles()} staged={false} />
            <Show when={!stagedFiles().length && !changedFiles().length}>
              <div class="git-clean">Изменений нет — всё закоммичено</div>
            </Show>
          </div>
          <History />
        </Show>
      </Show>
    </div>
  );
}
