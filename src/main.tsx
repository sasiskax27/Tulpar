import { render } from "solid-js/web";
import "./styles/base.css";
import App from "./app/App";
import { initConfig } from "./config/store";
import { installKeybindings } from "./keybindings/keybindings";
import { registerBuiltinCommands } from "./app/commands";
import { initWorkspaceEvents, openFolder } from "./app/workspace";
import { loadSession, openFile, setActivePath } from "./editor/tabs";
import { initLsp } from "./lsp/manager";
import { initTerminals } from "./terminal/sessions";
import { initFileDrop } from "./explorer/dnd";
import { initGit, refresh as refreshGit } from "./git/git";
import { initGitGutter } from "./git/gutter";
import { initProblems } from "./problems/problems";
import { scheduleUpdateCheck } from "./app/update";
import { initCopilot } from "./ai/copilot";
import { initOutline } from "./editor/outline";
import { registerInlineCompletions } from "./ai/inline";
import { initBackups } from "./editor/backup";
import { root } from "./app/workspace";
import { createEffect, createRoot, on } from "solid-js";

async function start() {
  registerBuiltinCommands();
  installKeybindings();
  render(() => <App />, document.getElementById("root")!);

  await Promise.all([initConfig(), initWorkspaceEvents()]);
  await initLsp();
  await initTerminals();
  await initFileDrop();
  await initGit();
  initGitGutter();
  initProblems();
  scheduleUpdateCheck();
  initCopilot();
  initOutline();
  registerInlineCompletions();
  initBackups();
  // Другая папка — свой репозиторий
  createRoot(() => createEffect(on(root, () => void refreshGit())));

  // Восстанавливаем прошлую сессию: папку и открытые вкладки
  const session = loadSession();
  if (session?.root && (await openFolder(session.root))) {
    for (const path of session.tabs) await openFile(path);
    if (session.active) setActivePath(session.active);
  }
}

void start();
