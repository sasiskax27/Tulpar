// Встроенные команды. id совпадают с VS Code, чтобы keybindings.json переносился один в один.
import { registerCommand } from "../commands/registry";
import { showPalette } from "../palette/Palette";
import { saveFile, saveAll, closeTab, cycleTab, openFile, activePath } from "../editor/tabs";
import { openFolder, root } from "./workspace";
import { bottomTab, bottomVisible, setBottomTab, setBottomVisible, setSidebarVisible, setSettingsVisible, setSidebarView, sidebarView, sidebarVisible, type SidebarView } from "./ui";
import { focusSearch } from "../search/SearchPanel";
import { switchBranch, commit, sync, refresh as gitRefresh } from "../git/git";
import { focusChat } from "../ai/ChatPanel";
import { setUseFile, newChat } from "../ai/chat";
import { runTask, runCurrentFile } from "../tasks/tasks";
import { editorInstance } from "../editor/instance";
import { activeLayout, defaultSettings, layoutConfig, setActiveLayout, settings, updateSetting } from "../config/store";
import { core, type ConfigName } from "../ipc";
import { notify } from "./notify";
import { restartLanguageServers } from "../lsp/manager";
import { toggleTerminal, newTerminal, killSession, runInTerminal } from "../terminal/sessions";
import { focusEditor } from "../editor/instance";
import { chooseBackground, clearBackground, usePhotoTheme } from "./background";
import { fixWithAi, problems, showProblems } from "../problems/problems";
import { cancelAi, runAiTask, tasks } from "../ai/ai";
import { cursor } from "../editor/tabs";
import { toggleBreakpoint, startOrContinue, stopDebugging, continueDebugging, stepOver, stepInto, stepOut, restartDebugging } from "../debug/debug";

/** Точка останова на строке, где сейчас курсор. */
function toggleBreakpointOnActiveLine() {
  const file = activePath();
  const pos = cursor();
  if (!file || !pos.line) {
    notify("Откройте файл и поставьте курсор на нужную строку");
    return;
  }
  toggleBreakpoint(file, pos.line);
}

/**
 * OpenCode — агент для кода в терминале. Его бесплатные облачные модели работают
 * только в самой программе OpenCode, поэтому Tulpar запускает её во вкладке
 * терминала в папке проекта, а не обращается к моделям напрямую.
 */
async function openOpenCode() {
  if (!root()) {
    notify("Сначала откройте папку проекта — OpenCode будет работать в ней");
    return;
  }
  const check = await core.agentRun("opencode --version", 20).catch(() => null);
  if (!check || check.code !== 0) {
    notify("OpenCode не установлен. Он ставится одной командой через npm (Node.js у вас уже есть).", "info", [
      {
        label: "Установить",
        run: () => {
          void runInTerminal("npm install -g @opencode/cli", "Установка OpenCode");
          notify("Когда установка закончится, снова нажмите «OpenCode».");
        },
      },
    ]);
    return;
  }
  await runInTerminal("opencode", "OpenCode");
}

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

  reg({ id: "workbench.view.scm", category: "Вид", title: "Git", run: (args) => { if (showView("git", args)) void gitRefresh(); } });
  // Чат живёт внизу рядом с терминалом или в боковой панели (tulpar.chat.location)
  const showChat = (args: unknown) => {
    if (settings()["tulpar.chat.location"] === "sidebar") {
      if (showView("chat", args)) focusChat();
      return;
    }
    const toggle = (args as { toggle?: boolean } | undefined)?.toggle;
    if (toggle && bottomVisible() && bottomTab() === "chat") {
      setBottomVisible(false);
      focusEditor();
      return;
    }
    setBottomTab("chat");
    setBottomVisible(true);
    focusChat();
  };
  reg({ id: "workbench.action.chat.open", category: "ИИ", title: "Чат с ИИ", run: (args) => showChat(args) });
  reg({
    id: "tulpar.chat.moveLocation",
    category: "ИИ",
    title: "Перенести чат вниз / в боковую панель",
    run: () => {
      const toSidebar = settings()["tulpar.chat.location"] !== "sidebar";
      updateSetting("tulpar.chat.location", toSidebar ? "sidebar" : "bottom");
      if (toSidebar) {
        if (bottomTab() === "chat") {
          setBottomTab("terminal");
          setBottomVisible(false);
        }
        showView("chat", undefined);
      } else {
        if (sidebarView() === "chat") setSidebarView("explorer");
        setBottomTab("chat");
        setBottomVisible(true);
      }
      focusChat();
    },
  });
  reg({ id: "outline.focus", category: "Вид", title: "Структура файла", run: (args) => showView("outline", args) });
  reg({
    id: "tulpar.web.preview",
    category: "Вид",
    title: "Предпросмотр сайта (localhost)…",
    run: async () => {
      const { askInput } = await import("./InputBox");
      const url = await askInput({ title: "Адрес dev-сервера", placeholder: "http://localhost:5173 или просто 5173", value: "http://localhost:5173" });
      if (!url) return;
      const u = /^\d+$/.test(url.trim()) ? `http://localhost:${url.trim()}` : /^https?:\/\//.test(url.trim()) ? url.trim() : `http://${url.trim()}`;
      const { showWeb } = await import("../editor/side");
      showWeb(u);
    },
  });
  reg({
    id: "jupyter.newNotebook",
    category: "Файл",
    title: "Новый блокнот Jupyter",
    run: async () => {
      const r = (await import("./workspace")).root();
      if (!r) return notify("Сначала откройте папку проекта");
      const { askInput } = await import("./InputBox");
      const name = await askInput({ title: "Имя блокнота", value: "notebook.ipynb" });
      if (!name) return;
      const file = name.endsWith(".ipynb") ? name : `${name}.ipynb`;
      const { serializeNotebook, emptyNotebook } = await import("../notebook/notebook");
      const sep = r.includes("\\") ? "\\" : "/";
      const path = r + sep + file;
      await core.writeFile(path, serializeNotebook(emptyNotebook()));
      await openFile(path);
    },
  });
  reg({ id: "tulpar.sync.upload", category: "Настройки", title: "Сохранить настройки в GitHub", run: () => void import("../settings/sync").then((m) => m.uploadSettings()) });
  reg({ id: "tulpar.sync.download", category: "Настройки", title: "Скачать настройки из GitHub", run: () => void import("../settings/sync").then((m) => m.downloadSettings()) });
  reg({ id: "tulpar.themes.gallery", category: "Вид", title: "Галерея тем", run: () => void import("./ThemeGallery").then((m) => m.showThemeGallery()) });
  reg({ id: "workbench.view.databases", category: "Вид", title: "Базы данных", run: (args) => showView("databases", args) });
  reg({ id: "workbench.view.testing", category: "Вид", title: "Тесты", run: (args) => showView("tests", args) });
  reg({ id: "testing.runAll", category: "Тесты", title: "Запустить все тесты", run: () => void import("../testing/tests").then((m) => m.runTests()) });
  reg({ id: "workbench.view.packages", category: "Вид", title: "Библиотеки: найти и подключить", run: (args) => showView("packages", args) });
  reg({ id: "workbench.view.extensions", category: "Вид", title: "Расширения: темы и сниппеты", run: (args) => showView("extensions", args) });
  reg({ id: "workbench.view.build", category: "Вид", title: "Сборка и проекты", run: (args) => showView("build", args) });
  reg({ id: "tulpar.chat.new", category: "ИИ", title: "Новый чат", run: () => newChat() });
  reg({ id: "tulpar.opencode.open", category: "ИИ", title: "Открыть OpenCode (бесплатные облачные модели)", run: () => openOpenCode() });
  reg({ id: "tulpar.chat.history", category: "ИИ", title: "История чатов…", run: () => import("../ai/ChatPanel").then((m) => m.showChatHistory()) });
  reg({
    id: "tulpar.chat.askSelection",
    category: "ИИ",
    title: "Спросить в чате о выделенном",
    run: () => {
      setUseFile(true);
      showChat(undefined);
    },
  });
  reg({ id: "workbench.action.tasks.runTask", category: "Задачи", title: "Запустить задачу проекта…", run: () => runTask() });
  reg({ id: "workbench.action.tasks.build", category: "Задачи", title: "Собрать проект…", run: () => runTask("build") });
  reg({ id: "workbench.action.tasks.test", category: "Задачи", title: "Запустить тесты…", run: () => runTask("test") });
  reg({ id: "tulpar.run.file", category: "Задачи", title: "Запустить текущий файл", run: () => runCurrentFile() });
  reg({ id: "workbench.action.splitEditor", category: "Вид", title: "Открыть файл рядом (справа)", run: () => import("../editor/side").then((m) => m.splitEditor()) });
  reg({ id: "markdown.showPreviewToSide", category: "Вид", title: "Предпросмотр Markdown", run: () => import("../editor/side").then((m) => m.previewMarkdown()) });
  reg({ id: "tulpar.html.preview", category: "Вид", title: "Показать HTML-страницу рядом", run: () => import("../editor/side").then((m) => m.previewHtml()) });
  reg({ id: "tulpar.side.close", category: "Вид", title: "Закрыть правую половину", run: () => import("../editor/side").then((m) => m.closeSide()) });
  reg({
    id: "workbench.action.openRecent",
    category: "Файл",
    title: "Открыть недавний проект…",
    run: async () => {
      const { recent } = await import("./workspace");
      const { pick } = await import("./QuickPick");
      const list = recent();
      if (!list.length) {
        notify("Недавних проектов пока нет");
        return;
      }
      const chosen = await pick<string>(list.map((p) => ({ label: p.split(/[\\/]/).pop() ?? p, detail: p, value: p })), "Недавние проекты");
      if (chosen) await openFolder(chosen);
    },
  });
  reg({ id: "git.clone", category: "Git", title: "Клонировать репозиторий…", run: () => import("../git/account").then((m) => m.cloneRepo()) });
  reg({ id: "tulpar.github.signIn", category: "Git", title: "Войти в GitHub", run: () => import("../git/account").then((m) => m.signInGithub()) });
  reg({ id: "tulpar.github.publish", category: "Git", title: "Опубликовать проект на GitHub", run: () => import("../git/account").then((m) => m.publishToGithub()) });
  reg({ id: "tulpar.git.identity", category: "Git", title: "Имя и почта для коммитов", run: () => import("../git/account").then((m) => m.setupIdentity()) });
  reg({ id: "git.checkout", category: "Git", title: "Переключить ветку…", run: () => switchBranch() });
  reg({ id: "git.commit", category: "Git", title: "Закоммитить", run: () => commit() });
  reg({ id: "git.push", category: "Git", title: "Отправить (push)", run: () => sync("push") });
  reg({ id: "git.pull", category: "Git", title: "Получить (pull)", run: () => sync("pull") });
  reg({ id: "git.fetch", category: "Git", title: "Проверить обновления (fetch)", run: () => sync("fetch") });
  reg({
    id: "workbench.action.gotoLine",
    category: "Перейти",
    title: "К строке…",
    run: () => editorInstance()?.getAction("editor.action.gotoLine")?.run(),
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
  reg({
    id: "workbench.actions.view.problems",
    category: "Вид",
    title: "Проблемы",
    run: () => {
      if (bottomVisible() && bottomTab() === "problems") setBottomVisible(false);
      else showProblems();
    },
  });
  reg({ id: "tulpar.problems.fixAll", category: "ИИ", title: "Исправить все проблемы с ИИ", run: () => fixWithAi(problems()) });
  reg({ id: "tulpar.onboarding", category: "Справка", title: "Мастер настройки Tulpar", run: () => import("./Onboarding").then((m) => m.showOnboarding()) });
  reg({ id: "tulpar.update.check", category: "Справка", title: "Проверить обновления", run: () => import("./update").then((m) => m.checkForUpdates(true)) });
  reg({ id: "tulpar.theme.fromPhoto", category: "Вид", title: "Тема из фоновой картинки", run: () => usePhotoTheme() });
  reg({ id: "tulpar.background.clear", category: "Вид", title: "Убрать фоновую картинку", run: () => clearBackground() });

  // Отладка: запуск, шаги и останов
  reg({ id: "workbench.action.debug.start", category: "Отладка", title: "Запустить отладку / продолжить", run: () => void startOrContinue() });
  reg({ id: "workbench.action.debug.restart", category: "Отладка", title: "Перезапустить отладку", run: () => void restartDebugging() });
  reg({ id: "workbench.action.debug.stop", category: "Отладка", title: "Остановить отладку", run: () => void stopDebugging() });
  reg({ id: "workbench.action.debug.continue", category: "Отладка", title: "Продолжить выполнение", run: () => void continueDebugging() });
  reg({ id: "workbench.action.debug.stepOver", category: "Отладка", title: "Шаг через строку", run: () => void stepOver() });
  reg({ id: "workbench.action.debug.stepInto", category: "Отладка", title: "Шаг в функцию", run: () => void stepInto() });
  reg({ id: "workbench.action.debug.stepOut", category: "Отладка", title: "Шаг из функции", run: () => void stepOut() });
  reg({ id: "editor.debug.action.toggleBreakpoint", category: "Отладка", title: "Точка останова на этой строке", run: toggleBreakpointOnActiveLine });

  // Действия ИИ: те же, что в меню по правому клику
  for (const task of tasks) {
    reg({ id: task.id, title: task.label, run: () => runAiTask(task.id) });
  }
  reg({ id: "tulpar.ai.cancel", title: "ИИ: Отменить запрос", run: () => cancelAi() });
  reg({ id: "workbench.action.openGlobalKeybindings", category: "Настройки", title: "Открыть keybindings.json", run: () => openConfig("keybindings.json") });
  reg({ id: "workbench.action.openSnippets", category: "Настройки", title: "Свои сниппеты (snippets.json)", run: () => openConfig("snippets.json") });
  reg({ id: "tulpar.openLanguageSettings", category: "Настройки", title: "Открыть languages.json", run: () => openConfig("languages.json") });
  reg({ id: "tulpar.lsp.restart", category: "Языки", title: "Перезапустить языковые серверы", run: () => restartLanguageServers() });
  reg({ id: "tulpar.openLayoutSettings", category: "Настройки", title: "Открыть layout.json", run: () => openConfig("layout.json") });
}
