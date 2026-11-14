// Git и GitHub: имя и почта для коммитов, вход в GitHub, клонирование,
// публикация проекта. Команды выполняются через git и GitHub CLI (gh),
// установленные на компьютере.
import { createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { core } from "../ipc";
import { notify, notifyError } from "../app/notify";
import { askInput } from "../app/InputBox";
import { openFolder, root } from "../app/workspace";
import { runInTerminal } from "../terminal/sessions";
import { refresh } from "./git";

export interface Identity {
  name: string;
  email: string;
}

const [identity, setIdentity] = createSignal<Identity | null>(null);
/** null — ещё не проверяли; true/false — есть ли GitHub CLI и выполнен ли вход */
const [github, setGithub] = createSignal<{ cli: boolean; user: string | null } | null>(null);
export { identity, github };

const isWindows = navigator.userAgent.includes("Windows");

/** Строка в кавычках для оболочки (PowerShell на Windows, sh на остальных). */
function quote(text: string): string {
  return isWindows ? `'${text.replace(/'/g, "''")}'` : `'${text.replace(/'/g, `'\\''`)}'`;
}

async function run(command: string, timeout = 30) {
  return core.agentRun(command, timeout).catch((e) => ({ code: -1, output: String(e), timedOut: false }));
}

/** Узнать имя/почту git и статус входа в GitHub. */
export async function checkAccount() {
  if (!root()) return;
  const [name, email, gh] = await Promise.all([
    run("git config --global user.name"),
    run("git config --global user.email"),
    run("gh auth status"),
  ]);
  setIdentity({ name: name.code === 0 ? name.output.trim() : "", email: email.code === 0 ? email.output.trim() : "" });
  const cli = !/not recognized|не распознано|not found|CommandNotFound/i.test(gh.output) && gh.code !== -1;
  const user = gh.output.match(/account\s+(\S+)/i)?.[1] ?? gh.output.match(/as\s+(\S+)/i)?.[1] ?? null;
  setGithub({ cli, user: gh.code === 0 ? user : null });
}

/** Спросить имя и почту и записать их в git (для всех проектов). */
export async function setupIdentity() {
  const current = identity();
  const name = await askInput({ title: "Имя для коммитов", placeholder: "Например: Artur", value: current?.name ?? "" });
  if (!name?.trim()) return;
  const email = await askInput({
    title: "Почта для коммитов",
    placeholder: "Та же, что в GitHub — тогда коммиты привяжутся к аккаунту",
    value: current?.email ?? "",
  });
  if (!email?.trim()) return;
  const a = await run(`git config --global user.name ${quote(name.trim())}`);
  const b = await run(`git config --global user.email ${quote(email.trim())}`);
  if (a.code !== 0 || b.code !== 0) {
    notifyError("Не удалось сохранить", (a.output + b.output).trim() || "git не найден");
    return;
  }
  notify("Имя и почта для коммитов сохранены");
  void checkAccount();
}

/** Вход в GitHub через GitHub CLI (откроется браузер). */
export async function signInGithub() {
  if (github()?.cli === false) {
    notify("Для входа нужна программа GitHub CLI. Установить её?", "info", [
      {
        label: "Установить",
        run: () => {
          void runInTerminal(isWindows ? "winget install --id GitHub.cli -e" : "brew install gh", "Установка GitHub CLI");
          notify("После установки перезапустите Tulpar и снова нажмите «Войти в GitHub».");
        },
      },
    ]);
    return;
  }
  await runInTerminal("gh auth login --web --git-protocol https", "GitHub");
  notify("В терминале появится код — нажмите Enter, браузер откроет GitHub, вставьте код. После входа push и pull работают без пароля.");
  window.setTimeout(() => void checkAccount(), 30000);
}

/** Клонировать репозиторий в выбранную папку и открыть его. */
export async function cloneRepo() {
  const url = await askInput({ title: "Клонировать репозиторий", placeholder: "https://github.com/автор/проект.git" });
  if (!url?.trim()) return;
  const parent = await open({ directory: true, title: "Куда положить проект" });
  if (typeof parent !== "string") return;
  const name = url.trim().replace(/\/+$/, "").split("/").pop()!.replace(/\.git$/, "");
  const target = `${parent}${parent.includes("\\") ? "\\" : "/"}${name}`;
  notify(`Клонирую ${name}…`);
  // git сам не открывает окна; команда выполняется в выбранной папке через cd
  const r = await run(`cd ${quote(parent)}; git clone ${quote(url.trim())}`.replace("; ", isWindows ? "; " : " && "), 600);
  if (r.code !== 0) {
    notifyError("Не удалось клонировать", r.output.trim().split("\n").slice(-3).join(" "));
    return;
  }
  await openFolder(target);
  notify(`Проект ${name} склонирован и открыт`);
}

/** Создать репозиторий на GitHub из текущего проекта и отправить код. */
export async function publishToGithub() {
  const r = root();
  if (!r) return;
  if (!github()?.user) {
    notify("Сначала войдите в GitHub", "info", [{ label: "Войти в GitHub", run: () => void signInGithub() }]);
    return;
  }
  const name = await askInput({ title: "Название репозитория на GitHub", value: r.split(/[\\/]/).pop() ?? "" });
  if (!name?.trim()) return;
  const visibility = await askInput({ title: "Видимость: public (виден всем) или private (только вам)", value: "private" });
  if (!visibility) return;
  const flag = visibility.trim().toLowerCase().startsWith("pub") ? "--public" : "--private";
  await runInTerminal(`gh repo create ${quote(name.trim())} ${flag} --source . --remote origin --push`, "GitHub");
  window.setTimeout(() => void refresh(), 8000);
}
