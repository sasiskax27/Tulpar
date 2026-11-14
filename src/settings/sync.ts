// Синхронизация настроек через GitHub: профиль (см. profile.ts) хранится в
// вашем личном секретном gist. На другом компьютере — «Скачать из GitHub».
// Работает через GitHub CLI (gh), вход в который уже есть в разделе Git.
import { core, parentDir } from "../ipc";
import { notify, notifyError } from "../app/notify";
import { parseJsonc } from "../config/jsonc";
import { buildProfile, applyProfile, type TulparProfile } from "./profile";
import { signInGithub } from "../git/account";

const FILE = "tulpar-profile.json";
const ID_KEY = "tulpar.sync.gistId";
const isWindows = navigator.userAgent.includes("Windows");

const quote = (s: string) => (isWindows ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`);

async function gh(args: string): Promise<string> {
  const r = await core.agentRun(`gh ${args}`, 60);
  if (r.code !== 0) {
    const out = r.output.trim();
    if (/not recognized|not found|command not found/i.test(out)) throw new Error("NO_GH");
    if (/auth login|not logged|authentication/i.test(out)) throw new Error("NO_AUTH");
    if (/scope|gist/i.test(out) && /403|404/i.test(out)) throw new Error("NO_SCOPE");
    throw new Error(out.split("\n").slice(-3).join(" ") || `gh завершился с кодом ${r.code}`);
  }
  return r.output.trim();
}

function explain(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "NO_GH" || msg === "NO_AUTH") {
    notify("Для синхронизации войдите в GitHub (нужен GitHub CLI).", "info", [{ label: "Войти в GitHub", run: () => void signInGithub() }]);
  } else if (msg === "NO_SCOPE") {
    notify("У входа в GitHub нет доступа к gist. Выполните в терминале: gh auth refresh -s gist", "error");
  } else notifyError("Синхронизация настроек", e);
}

/** id gist с профилем: запомненный или найденный среди ваших gist. */
async function findGist(): Promise<string | null> {
  const saved = localStorage.getItem(ID_KEY);
  if (saved) return saved;
  const out = await gh(`api gists --jq ${quote(`.[] | select(.files["${FILE}"]) | .id`)}`);
  const id = out.split(/\s+/).find((x) => /^[0-9a-f]{20,}$/i.test(x)) ?? null;
  if (id) localStorage.setItem(ID_KEY, id);
  return id;
}

/** Временный файл профиля в папке настроек Tulpar (gh читает его через @путь). */
async function writeTemp(content: string): Promise<string> {
  const settingsPath = await core.configEnsure("settings.json");
  const dir = parentDir(settingsPath);
  const path = `${dir}${dir.includes("\\") ? "\\" : "/"}${FILE}`;
  await core.writeFile(path, content);
  return path;
}

export async function uploadSettings(): Promise<void> {
  try {
    const path = await writeTemp(JSON.stringify(buildProfile(), null, 2) + "\n");
    const field = quote(`files[${FILE}][content]=@${path}`);
    let id = await findGist().catch((e) => {
      if (e instanceof Error && e.message.startsWith("NO_")) throw e;
      return null;
    });
    if (id) {
      try {
        await gh(`api -X PATCH gists/${id} -F ${field}`);
      } catch {
        // gist удалили — создадим новый
        localStorage.removeItem(ID_KEY);
        id = null;
      }
    }
    if (!id) {
      const out = await gh(`api -X POST gists -f ${quote("description=Tulpar settings")} -F public=false -F ${field} --jq .id`);
      id = out.trim().split(/\s+/).pop() ?? null;
      if (id) localStorage.setItem(ID_KEY, id);
    }
    notify("Настройки сохранены в GitHub (секретный gist). На другом компьютере: «Скачать из GitHub».");
  } catch (e) {
    explain(e);
  }
}

export async function downloadSettings(): Promise<void> {
  try {
    const id = await findGist();
    if (!id) {
      notify("В вашем GitHub пока нет сохранённых настроек Tulpar. Сначала нажмите «Сохранить в GitHub» там, где они есть.");
      return;
    }
    const text = await gh(`api gists/${id} --jq ${quote(`.files["${FILE}"].content`)}`);
    let profile: TulparProfile | null = null;
    try {
      profile = parseJsonc<TulparProfile>(text);
    } catch {
      /* ниже */
    }
    if (!profile || profile.app !== "tulpar-profile") {
      notify("Сохранённые в GitHub настройки повреждены", "error");
      return;
    }
    await applyProfile(profile);
  } catch (e) {
    explain(e);
  }
}
