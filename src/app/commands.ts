// Встроенные команды. id совпадают с VS Code, чтобы keybindings.json переносился один в один.
import { registerCommand } from "../commands/registry";
import { showPalette } from "../palette/Palette";
import { saveFile, saveAll, closeTab, cycleTab, openFile } from "../editor/tabs";
import { openFolder } from "./workspace";
import { setSidebarVisible, setSettingsVisible, setSidebarView, sidebarView, sidebarVisible, type SidebarView } from "./ui";
import { focusSearch } from "../search/SearchPanel";
import { editorInstance } from "../editor/instance";
import { activeLayout, defaultSettings, layoutConfig, setActiveLayout, settings, updateSetting } from "../config/store";
import { core, type ConfigName } from "../ipc";
import { notify } from "./notify";
import { restartLanguageServers } from "../lsp/manager";
import { toggleTerminal, newTerminal, killSession } from "../terminal/sessions";
import { focusEditor } from "../editor/instance";
import { chooseBackground, clearBackground } from "./background";
import { cancelAi, runAiTask, tasks } from "../ai/ai";

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

  // Показать панель в боковой полосе. { toggle: true } — повторное нажатие прячет её.
  const showView = (view: SidebarView, args: unknown) => {
    const toggle = (args as { toggle?: boolean } | undefined)?.toggle;
    if (toggle && sidebarVisible() && sidebarView() === view) {
      setSidebarVisible(false);
      return false;
    }
    setSidebarView(view);
    setSidebarVisible(true);
    return true;
  };
  reg({ id: "workbench.view.explorer", category: "Вид", title: "Проводник", run: (args) => showView("explorer", args) });
  reg({
    id: "workbench.view.search",
    category: "Вид",
    title: "Поиск по проекту",
    run: (args) => {
      if (!showView("search", args)) return;
      // Выделенный в редакторе текст сразу становится запросом
      const editor = editorInstance();
      const sel = editor?.getSelection();
      const text = sel && !sel.isEmpty() ? editor!.getModel()?.getValueInRange(sel) : undefined;
      focusSearch(text && !text.includes("\n") ? text : undefined);
    },
  });

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

  reg({ id: "workbench.action.openSettings", category: "Настройки", title: "Открыть настройки", run: () => setSettingsVisible((v) => !v) });
  reg({ id: "workbench.action.openSettingsJson", category: "Настройки", title: "Открыть settings.json", run: () => openConfig("settings.json") });

  // Размер шрифта с клавиатуры
  const zoom = (delta: number) =>
    updateSetting("editor.fontSize", Math.min(40, Math.max(8, settings()["editor.fontSize"] + delta)));
  reg({ id: "editor.action.fontZoomIn", category: "Вид", title: "Увеличить шрифт", run: () => zoom(1) });
  reg({ id: "editor.action.fontZoomOut", category: "Вид", title: "Уменьшить шрифт", run: () => zoom(-1) });
  reg({ id: "editor.action.fontZoomReset", category: "Вид", title: "Сбросить размер шрифта", run: () => updateSetting("editor.fontSize", defaultSettings["editor.fontSize"]) });

  reg({ id: "tulpar.background.choose", category: "Вид", title: "Выбрать фоновую картинку…", run: () => chooseBackground() });
  reg({ id: "tulpar.background.clear", category: "Вид", title: "Убрать фоновую картинку", run: () => clearBackground() });

  // Действия ИИ: те же, что в меню по правому клику
  for (const task of tasks) {
    reg({ id: task.id, title: task.label, run: () => runAiTask(task.id) });
  }
  reg({ id: "tulpar.ai.cancel", title: "ИИ: Отменить запрос", run: () => cancelAi() });
  reg({ id: "workbench.action.openGlobalKeybindings", category: "Настройки", title: "Открыть keybindings.json", run: () => openConfig("keybindings.json") });
  reg({ id: "tulpar.openLanguageSettings", category: "Настройки", title: "Открыть languages.json", run: () => openConfig("languages.json") });
  reg({ id: "tulpar.lsp.restart", category: "Языки", title: "Перезапустить языковые серверы", run: () => restartLanguageServers() });
  reg({ id: "tulpar.openLayoutSettings", category: "Настройки", title: "Открыть layout.json", run: () => openConfig("layout.json") });
}
