// Определяем систему, чтобы каждый пункт магазина ставился «по-своему».
import { core } from "../ipc";

const ua = navigator.userAgent;
export const OS: "windows" | "mac" | "linux" = ua.includes("Windows") ? "windows" : ua.includes("Mac") ? "mac" : "linux";
export const ARM = /arm64|aarch64/i.test(ua);

export type LinuxPm = "apt" | "dnf" | "pacman" | "zypper" | "unknown";
let pmCache: LinuxPm | null = null;

/** Менеджер пакетов Linux: apt (Ubuntu/Debian), dnf (Fedora), pacman (Arch)… */
export async function linuxPm(): Promise<LinuxPm> {
  if (pmCache) return pmCache;
  const r = await core.agentRun("cat /etc/os-release 2>/dev/null", 10).catch(() => null);
  const t = r?.output.toLowerCase() ?? "";
  pmCache = /ubuntu|debian|mint|pop|elementary|kali/.test(t) ? "apt" : /fedora|rhel|centos|rocky|alma/.test(t) ? "dnf" : /arch|manjaro|endeavour/.test(t) ? "pacman" : /suse/.test(t) ? "zypper" : "unknown";
  return pmCache;
}

export async function systemInstall(pkgs: { apt?: string; dnf?: string; pacman?: string; zypper?: string; brew?: string }): Promise<string | null> {
  if (OS === "mac") return pkgs.brew ? `brew install ${pkgs.brew}` : null;
  if (OS === "linux") {
    const pm = await linuxPm();
    const name = pm !== "unknown" ? pkgs[pm] : undefined;
    if (!name) return null;
    return pm === "apt" ? `sudo apt update && sudo apt install -y ${name}` : pm === "dnf" ? `sudo dnf install -y ${name}` : pm === "pacman" ? `sudo pacman -S --noconfirm ${name}` : `sudo zypper install -y ${name}`;
  }
  return null;
}

export interface GhRelease { tag_name: string; assets: { name: string; browser_download_url: string }[] }

export async function getJson<T>(url: string): Promise<T> {
  const r = await core.httpRequest({ method: "GET", url, headers: [["Accept", "application/json"], ["User-Agent", "Tulpar"]], body: null, timeoutSecs: 40 });
  if (r.status !== 200) throw new Error(`${new URL(url).host} ответил ${r.status}`);
  return JSON.parse(r.body) as T;
}

export async function getText(url: string): Promise<string> {
  const r = await core.httpRequest({ method: "GET", url, headers: [["User-Agent", "Tulpar"]], body: null, timeoutSecs: 40 });
  if (r.status !== 200) throw new Error(`${new URL(url).host} ответил ${r.status}`);
  return r.body;
}

/** Последний релиз на GitHub и подходящий файл. */
export async function ghAsset(repo: string, match: RegExp): Promise<{ url: string; version: string }> {
  const rel = await getJson<GhRelease>(`https://api.github.com/repos/${repo}/releases/latest`);
  const a = rel.assets.find((x) => match.test(x.name));
  if (!a) throw new Error(`в релизе ${repo} нет сборки для этой системы`);
  return { url: a.browser_download_url, version: rel.tag_name.replace(/^v/, "") };
}
