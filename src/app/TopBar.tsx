// Верхняя панель Дизайна 2: знак Tulpar, папка и ветка, ИИ-остров по центру
// (поиск команд; пока ИИ работает — показывает, чем он занят) и кнопки разделов.
import { current as buildTarget, status as buildStatus } from "../build/build";
import { For, Show } from "solid-js";
import { executeCommand } from "../commands/registry";
import { root } from "./workspace";
import { baseName } from "../ipc";
import { status as gitStatus } from "../git/git";
import { aiBusy, cancelAi } from "../ai/ai";
import { collecting, streaming, stop as stopChat } from "../ai/chat";
import { Badge, hint, icons, isViewActive, VIEWS } from "./views";
import { keybindingFor } from "../keybindings/keybindings";

export default function TopBar() {
  const busy = () => aiBusy() ?? collecting() ?? (streaming() !== null ? "Отвечает в чате" : null);

  return (
    <header class="top-bar">
      <div class="top-left">
        <div class="top-mark" aria-hidden="true">T</div>
        <span class="top-name">Tulpar</span>
        <button
          class="top-btn"
          title={hint("Боковая панель", "workbench.action.toggleSidebarVisibility")}
          aria-label="Боковая панель"
          onClick={() => void executeCommand("workbench.action.toggleSidebarVisibility")}
        >
          {icons.sidebar(17)}
        </button>
        <Show when={root()}>
          <button class="top-folder" title={root()!} onClick={() => void executeCommand("workbench.action.files.openFolder")}>
            {baseName(root()!)}
          </button>
        </Show>
        <Show when={gitStatus()?.isRepo}>
          <button class="top-branch" title="Переключить ветку" onClick={() => void executeCommand("git.checkout")}>
            ⎇ {gitStatus()?.branch ?? "без ветки"}
          </button>
        </Show>
      </div>

      <div class="top-center">
        <button
          class="ai-island"
          classList={{ busy: !!busy() }}
          title={busy() ? "Остановить" : "Команды, файлы и ИИ"}
          onClick={() => {
            if (aiBusy()) cancelAi();
            else if (streaming() !== null) void stopChat();
            else void executeCommand("workbench.action.showCommands");
          }}
        >
          <span class="ai-spark" aria-hidden="true">{icons.chat(15)}</span>
          <Show
            when={busy()}
            fallback={
              <>
                <span class="ai-text">Команда, файл или вопрос ИИ</span>
                <kbd>{keybindingFor("workbench.action.showCommands") ?? "Ctrl+Shift+P"}</kbd>
              </>
            }
          >
            <span class="ai-text">{busy()}…</span>
            <span class="ai-stop">Стоп</span>
          </Show>
        </button>
      </div>

      <div class="top-right">
        <For each={VIEWS}>
          {(v) => (
            <button
              class="top-btn"
              classList={{ active: isViewActive(v.view) }}
              title={hint(v.title, v.command)}
              aria-label={v.title}
              onClick={() => void executeCommand(v.command, { toggle: true })}
            >
              {v.icon(17)}
              <Badge count={v.badge?.()} />
            </button>
          )}
        </For>
        <span class="top-sep" />
        <button
          class="top-btn top-build"
          classList={{ busy: buildStatus() === "running" || buildStatus() === "prepare" }}
          title={buildStatus() === "running" || buildStatus() === "prepare" ? "Остановить сборку" : hint(buildTarget() ? `Собрать и запустить: ${buildTarget()!.label}` : "Собрать и запустить", "tulpar.build.run")}
          aria-label="Собрать и запустить"
          onClick={() => void executeCommand(buildStatus() === "running" || buildStatus() === "prepare" ? "tulpar.build.stop" : "tulpar.build.run")}
        >
          {buildStatus() === "running" || buildStatus() === "prepare" ? icons.stopSq(16) : icons.play(16)}
        </button>
        <button
          class="top-btn"
          title={hint("Command Center", "tulpar.commandCenter")}
          aria-label="Command Center"
          onClick={() => void executeCommand("tulpar.commandCenter")}
        >
          {icons.center(17)}
        </button>
        <button
          class="top-btn top-store"
          title={hint("Магазин Tulpar", "tulpar.store")}
          aria-label="Магазин Tulpar"
          onClick={() => void executeCommand("tulpar.store")}
        >
          {icons.store(17)}
        </button>
        <button
          class="top-btn"
          title={hint("Терминал", "workbench.action.terminal.toggleTerminal")}
          aria-label="Терминал"
          onClick={() => void executeCommand("workbench.action.terminal.toggleTerminal")}
        >
          {icons.terminal(17)}
        </button>
        <button
          class="top-btn"
          title={hint("Настройки", "workbench.action.openSettings")}
          aria-label="Настройки"
          onClick={() => void executeCommand("workbench.action.openSettings")}
        >
          {icons.settings(17)}
        </button>
      </div>
    </header>
  );
}
