// Встроенные команды. id совпадают с VS Code, чтобы keybindings.json переносился один в один.
import { registerCommand } from "../commands/registry";
import { showPalette } from "../palette/Palette";
import { saveFile, saveAll, closeTab, cycleTab, openFile } from "../editor/tabs";
import { openFolder } from "./workspace";
import { setSidebarVisible } from "./ui";
import { activeLayout, layoutConfig, setActiveLayout } from "../config/store";
import { core, type ConfigName } from "../ipc";
import { notify } from "./notify";
import { restartLanguageServers } from "../lsp/manager";
import { toggleTerminal, newTerminal, killSession } from "../terminal/sessions";
import { focusEditor } from "../editor/instance";

async function openConfig(name: ConfigName) {
  const path = await core.configEnsure(name);
  await openFile(path);
}

let layoutBeforeZen: string | null = null;

export function registerBuiltinCommands() {
  const reg = registerCommand;

  reg({ id: "workbench.action.showCommands", title: "Показать все команды", run: () => showPalette(">") });
  reg({ id: "workbench.action.quickOpen", title: "Перейти к файлу", run: () => showPalette("") });

  reg({ id: "workbench.action.files.openFolder", category: "Файл", title: "Открыть папку…", run: () => openFolder() });
  reg({ id: "workbench.action.files.save", category: "Файл", title: "Сохранить", run: () => saveFile() });
  reg({ id: "workbench.action.files.saveAll", category: "Файл", title: "Сохранить всё", run: () => saveAll() });
  reg({ id: "workbench.action.closeActiveEditor", category: "Вид", title: "Закрыть вкладку", run: () => closeTab() });
  reg({ id: "workbench.action.nextEditor", category: "Вид", title: "Следующая вкладка", run: () => cycleTab(1) });
  reg({ id: "workbench.action.previousEditor", category: "Вид", title: "Предыдущая вкладка", run: () => cycleTab(-1) });

  reg({
    id: "workbench.action.toggleSidebarVisibility",
    category: "Вид",
    title: "Показать/скрыть боковую панель",
    run: () => setSidebarVisible((v) => !v),
  });

  reg({
    id: "workbench.action.toggleZenMode",
    category: "Вид",
    title: "Режим фокуса",
    run: () => {
      const layouts = layoutConfig().layouts;
      if (layoutBeforeZen) {
        setActiveLayout(layoutBeforeZen);
        layoutBeforeZen = null;
      } else if (layouts["Фокус"]) {
        layoutBeforeZen = activeLayout();
        setActiveLayout("Фокус");
      }
    },
  });

  reg({
    id: "tulpar.layout.next",
    category: "Вид",
    title: "Следующая раскладка",
    run: () => {
      const names = Object.keys(layoutConfig().layouts);
      const next = names[(names.indexOf(activeLayout()) + 1) % names.length];
      setActiveLayout(next);
      notify(`Раскладка: ${next}`);
    },
  });

  reg({ id: "workbench.action.terminal.toggleTerminal", category: "Терминал", title: "Показать/скрыть терминал", run: () => toggleTerminal() });
  reg({ id: "workbench.action.terminal.new", category: "Терминал", title: "Новый терминал", run: () => newTerminal() });
  reg({ id: "workbench.action.terminal.kill", category: "Терминал", title: "Закрыть активный терминал", run: () => killSession() });
  reg({ id: "workbench.action.focusActiveEditorGroup", category: "Вид", title: "Перейти в редактор", run: () => focusEditor() });

  reg({ id: "workbench.action.openSettings", category: "Настройки", title: "Открыть settings.json", run: () => openConfig("settings.json") });
  reg({ id: "workbench.action.openGlobalKeybindings", category: "Настройки", title: "Открыть keybindings.json", run: () => openConfig("keybindings.json") });
  reg({ id: "tulpar.openLanguageSettings", category: "Настройки", title: "Открыть languages.json", run: () => openConfig("languages.json") });
  reg({ id: "tulpar.lsp.restart", category: "Языки", title: "Перезапустить языковые серверы", run: () => restartLanguageServers() });
  reg({ id: "tulpar.openLayoutSettings", category: "Настройки", title: "Открыть layout.json", run: () => openConfig("layout.json") });
}
