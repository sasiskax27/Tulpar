// Раздел настроек «SDK и инструменты»: что установлено на компьютере (Python,
// Node.js, JDK, Maven, Gradle, .NET, Go, Rust, Git…) и установка одной кнопкой.
import { createSignal, For, onMount, Show } from "solid-js";
import { core } from "../ipc";
import { runInTerminal } from "../terminal/sessions";
import { notify } from "../app/notify";

const isWindows = navigator.userAgent.includes("Windows");
const isMac = navigator.userAgent.includes("Mac");

interface Tool {
  id: string;
  title: string;
  check: string;
  /** Для чего нужен */
  note: string;
  winget?: string;
  scoop?: string;
  brew?: string;
  apt?: string;
}

const TOOLS: Tool[] = [
  { id: "python", title: "Python", check: isWindows ? "python --version" : "python3 --version", note: "Python и pip", winget: "Python.Python.3.13", brew: "python", apt: "python3 python3-pip" },
  { id: "node", title: "Node.js", check: "node --version", note: "JavaScript, TypeScript, npm", winget: "OpenJS.NodeJS.LTS", brew: "node", apt: "nodejs npm" },
  { id: "java", title: "Java (JDK 21)", check: "java -version", note: "Java, Kotlin, Maven, Gradle", winget: "EclipseAdoptium.Temurin.21.JDK", brew: "openjdk@21", apt: "openjdk-21-jdk" },
  { id: "maven", title: "Maven", check: "mvn -v", note: "Сборка Java-проектов с pom.xml. Если в проекте есть mvnw, ставить не нужно.", scoop: "maven", brew: "maven", apt: "maven" },
  { id: "gradle", title: "Gradle", check: "gradle -v", note: "Сборка Java/Kotlin/Android. Если в проекте есть gradlew, ставить не нужно.", scoop: "gradle", brew: "gradle", apt: "gradle" },
  { id: "dotnet", title: ".NET SDK", check: "dotnet --version", note: "C#, F#", winget: "Microsoft.DotNet.SDK.8", brew: "dotnet", apt: "dotnet-sdk-8.0" },
  { id: "go", title: "Go", check: "go version", note: "Язык Go", winget: "GoLang.Go", brew: "go", apt: "golang" },
  { id: "rust", title: "Rust", check: "rustc --version", note: "Rust и cargo (через rustup)", winget: "Rustlang.Rustup", brew: "rustup", apt: "rustup" },
  { id: "git", title: "Git", check: "git --version", note: "Контроль версий", winget: "Git.Git", brew: "git", apt: "git" },
  { id: "gh", title: "GitHub CLI", check: "gh --version", note: "Вход в GitHub, публикация проектов", winget: "GitHub.cli", brew: "gh", apt: "gh" },
  { id: "cmake", title: "CMake", check: "cmake --version", note: "Сборка C/C++", winget: "Kitware.CMake", brew: "cmake", apt: "cmake" },
];

function installCommand(t: Tool): string | null {
  if (isWindows) {
    if (t.winget) return `winget install -e --id ${t.winget}`;
    if (t.scoop) return `scoop install ${t.scoop}`;
    return null;
  }
  if (isMac) return t.brew ? `brew install ${t.brew}` : null;
  return t.apt ? `sudo apt install -y ${t.apt}` : null;
}

/** Версия из вывода команды: первое «число.число[.число]». */
function versionOf(output: string): string | null {
  return output.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null;
}

export default function Toolchains() {
  const [found, setFound] = createSignal<Record<string, string | null | undefined>>({});
  const [checking, setChecking] = createSignal(false);

  const check = async () => {
    setChecking(true);
    const results = await Promise.all(
      TOOLS.map(async (t) => {
        const r = await core.agentRun(t.check, 20).catch(() => null);
        // java пишет версию в stderr — agent_run склеивает вывод
        return [t.id, r && r.code === 0 ? versionOf(r.output) ?? "есть" : null] as const;
      }),
    );
    setFound(Object.fromEntries(results));
    setChecking(false);
  };
  onMount(() => void check());

  const install = (t: Tool) => {
    const cmd = installCommand(t);
    if (!cmd) return;
    if (cmd.startsWith("scoop")) {
      notify("Нужен менеджер пакетов Scoop (scoop.sh). Если его нет, команда в терминале сообщит об этом.");
    }
    void runInTerminal(cmd, `Установка ${t.title}`);
    notify(`Когда установка ${t.title} закончится, перезапустите Tulpar и нажмите «Проверить снова».`);
  };

  return (
    <div class="toolchains">
      <div class="settings-row">
        <div class="settings-label">
          <span>Что установлено на компьютере</span>
          <small>Tulpar проверяет программы, нужные для запуска и сборки проектов.</small>
        </div>
        <div class="settings-control settings-buttons">
          <button class="button-quiet" disabled={checking()} onClick={() => void check()}>
            {checking() ? "Проверяю…" : "Проверить снова"}
          </button>
        </div>
      </div>
      <For each={TOOLS}>
        {(t) => (
          <div class="model-row">
            <div class="model-info">
              <span class="model-title">
                {t.title}
                <Show when={found()[t.id]}>
                  <span class="model-badge ok">{found()[t.id] === "есть" ? "установлен" : found()[t.id]}</span>
                </Show>
                <Show when={found()[t.id] === null}>
                  <span class="model-badge paid">не найден</span>
                </Show>
              </span>
              <small>{t.note}</small>
            </div>
            <div class="model-actions">
              <Show when={found()[t.id] === null && installCommand(t)}>
                <button class="button" onClick={() => install(t)} title={installCommand(t)!}>
                  Установить
                </button>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
