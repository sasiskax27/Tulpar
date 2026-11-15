// ⚡ Языки в один клик: находим свежую версию на официальном источнике и
// просим Rust скачать и распаковать её в папку Tulpar.
import { createSignal } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { core } from "../ipc";
import { notify } from "../app/notify";

const ua = navigator.userAgent;
const OS = ua.includes("Windows") ? "windows" : ua.includes("Mac") ? "mac" : "linux";
const ARM = /arm64|aarch64/i.test(ua);

export interface RuntimeDef {
  kind: string;
  title: string;
  /** Что даёт */
  note: string;
  /** Команда проверки — та же, что в «SDK и инструменты» */
  tool: string;
  resolve: () => Promise<{ url: string; version: string }>;
  bins: string[];
}

async function getJson<T>(url: string): Promise<T> {
  const r = await core.httpRequest({ method: "GET", url, headers: [["Accept", "application/json"], ["User-Agent", "Tulpar"]], body: null, timeoutSecs: 40 });
  if (r.status !== 200) throw new Error(`${new URL(url).host} ответил ${r.status}`);
  return JSON.parse(r.body) as T;
}

interface GhRelease { tag_name: string; assets: { name: string; browser_download_url: string }[] }

const TRIPLE = OS === "windows" ? "x86_64-pc-windows-msvc" : OS === "mac" ? (ARM ? "aarch64-apple-darwin" : "x86_64-apple-darwin") : ARM ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";

export const RUNTIMES: RuntimeDef[] = [
  {
    kind: "python",
    title: "Python",
    note: "с pip — из официальных сборок python-build-standalone на GitHub",
    tool: "python",
    bins: OS === "windows" ? ["", "Scripts"] : ["bin"],
    resolve: async () => {
      const rel = await getJson<GhRelease>("https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest");
      const make = (minor: string) => new RegExp(`^cpython-(3\\.${minor}\\.\\d+)\\+\\d+-${TRIPLE.replace(/[-.]/g, "\\$&")}-install_only\\.tar\\.gz$`);
      // Предпочитаем 3.13 (с ней совместимы почти все библиотеки), иначе — самая свежая
      let re = make("13");
      let a = rel.assets.find((x) => re.test(x.name));
      if (!a) {
        re = make("\\d+");
        a = rel.assets.filter((x) => re.test(x.name)).sort((x, y) => y.name.localeCompare(x.name, undefined, { numeric: true }))[0];
      }
      if (!a) throw new Error("не нашёл сборку Python для этой системы");
      return { url: a.browser_download_url, version: re.exec(a.name)![1] };
    },
  },
  {
    kind: "node",
    title: "Node.js LTS",
    note: "с npm — с nodejs.org",
    tool: "node",
    bins: OS === "windows" ? [""] : ["bin"],
    resolve: async () => {
      const list = await getJson<{ version: string; lts: string | false }[]>("https://nodejs.org/dist/index.json");
      const v = list.find((x) => x.lts)!.version;
      const plat = OS === "windows" ? `win-${ARM ? "arm64" : "x64"}.zip` : OS === "mac" ? `darwin-${ARM ? "arm64" : "x64"}.tar.gz` : `linux-${ARM ? "arm64" : "x64"}.tar.gz`;
      return { url: `https://nodejs.org/dist/${v}/node-${v}-${plat}`, version: v.replace(/^v/, "") };
    },
  },
  {
    kind: "go",
    title: "Go",
    note: "с go.dev",
    tool: "go",
    bins: ["bin"],
    resolve: async () => {
      const list = await getJson<{ version: string; files: { filename: string; os: string; arch: string; kind: string }[] }[]>("https://go.dev/dl/?mode=json");
      const goOs = OS === "mac" ? "darwin" : OS;
      const f = list[0].files.find((x) => x.os === goOs && x.arch === (ARM ? "arm64" : "amd64") && x.kind === "archive");
      if (!f) throw new Error("не нашёл сборку Go для этой системы");
      return { url: `https://go.dev/dl/${f.filename}`, version: list[0].version.replace(/^go/, "") };
    },
  },
  {
    kind: "java",
    title: "Java 21 (Temurin)",
    note: "JDK от Eclipse Adoptium — для Java, Kotlin, Maven, Gradle",
    tool: "java",
    bins: OS === "mac" ? ["Contents/Home/bin"] : ["bin"],
    resolve: async () => ({
      url: `https://api.adoptium.net/v3/binary/latest/21/ga/${OS}/${ARM ? "aarch64" : "x64"}/jdk/hotspot/normal/eclipse`,
      version: "21",
    }),
  },
  {
    kind: "uv",
    title: "uv",
    note: "очень быстрый менеджер пакетов и окружений Python (astral-sh/uv на GitHub)",
    tool: "uv",
    bins: [""],
    resolve: async () => {
      const rel = await getJson<GhRelease>("https://api.github.com/repos/astral-sh/uv/releases/latest");
      const name = `uv-${TRIPLE}.${OS === "windows" ? "zip" : "tar.gz"}`;
      const a = rel.assets.find((x) => x.name === name);
      if (!a) throw new Error("не нашёл сборку uv для этой системы");
      return { url: a.browser_download_url, version: rel.tag_name };
    },
  },
];

export const runtimeFor = (tool: string) => RUNTIMES.find((r) => r.tool === tool || r.kind === tool);

const [progress, setProgress] = createSignal<Record<string, { done: number; total: number; stage: string }>>({});
export { progress as runtimeProgress };
let listening = false;

export async function installRuntime(def: RuntimeDef): Promise<boolean> {
  if (!listening) {
    listening = true;
    void listen<{ kind: string; done: number; total: number; stage: string }>("runtime-progress", (e) => setProgress((p) => ({ ...p, [e.payload.kind]: e.payload })));
  }
  setProgress((p) => ({ ...p, [def.kind]: { done: 0, total: 0, stage: "resolve" } }));
  try {
    const { url, version } = await def.resolve();
    notify(`⚡ Скачиваю ${def.title} ${version}…`);
    await core.runtimeInstall(def.kind, url, def.bins, version);
    notify(`✓ ${def.title} ${version} установлен в Tulpar. Новые терминалы уже его видят.`);
    void import("../flight/flight").then((f) => f.log("run", `Установлен ${def.title} ${version}`, true));
    return true;
  } catch (e) {
    notify(`Не удалось поставить ${def.title}: ${e}`, "error");
    return false;
  } finally {
    setProgress((p) => {
      const n = { ...p };
      delete n[def.kind];
      return n;
    });
  }
}
