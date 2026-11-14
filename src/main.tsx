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
import { initDragDrop } from "./app/background";

async function start() {
  registerBuiltinCommands();
  installKeybindings();
  render(() => <App />, document.getElementById("root")!);

  await Promise.all([initConfig(), initWorkspaceEvents()]);
  await initLsp();
  await initTerminals();
  await initDragDrop();

  // Восстанавливаем прошлую сессию: папку и открытые вкладки
  const session = loadSession();
  if (session?.root && (await openFolder(session.root))) {
    for (const path of session.tabs) await openFile(path);
    if (session.active) setActivePath(session.active);
  }
}

void start();
