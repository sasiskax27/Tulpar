// 📱 Android в Tulpar: SDK, телефоны, шаблоны проектов, сборка APK и запуск.
// Всё ставится в папку Tulpar (runtimes/android-sdk), Android Studio не нужна.
import { createSignal } from "solid-js";
import { core, joinPath, baseName } from "../ipc";
import { root } from "../app/workspace";
import { notify, notifyError } from "../app/notify";
import { runInTerminal } from "../terminal/sessions";
import { OS } from "../store/platform";
import { TEMPLATE_FILES, type AppTemplate } from "./templates";

export const PLATFORM = "android-36";
export const BUILD_TOOLS = "36.0.0";
export const SYSTEM_IMAGE = `system-images;${PLATFORM};google_apis;${OS === "mac" && /arm|aarch/i.test(navigator.userAgent) ? "arm64-v8a" : "x86_64"}`;
export const AVD = "Tulpar_Phone";

const WIN = OS === "windows";
const ext = (name: string, win: string) => (WIN ? `${name}${win}` : name);

// ---------- пути ----------

export const sdkRoot = () => core.servicePath("android-sdk", "");
const cmdlineBin = (tool: string) => core.servicePath("android-cmdline", `bin/${ext(tool, ".bat")}`);
export const adbPath = async () => joinPath(await sdkRoot(), `platform-tools/${ext("adb", ".exe")}`);
const emulatorPath = async () => joinPath(await sdkRoot(), `emulator/${ext("emulator", ".exe")}`);

async function gradlePath(): Promise<string> {
  const p = await core.servicePath("gradle", `bin/${ext("gradle", ".bat")}`);
  return (await fileExists(p)) ? p : "gradle";
}

/** Вызов программы в терминале: в PowerShell путь в кавычках нужно запускать через &. */
export const exe = (path: string) => (path.includes("/") || path.includes("\\") ? (WIN ? `& "${path}"` : `"${path}"`) : path);
const quote = (s: string) => `"${s}"`;

/** Цепочка команд, которая останавливается на первой ошибке (PowerShell 5 не знает &&). */
export function chain(cmds: string[]): string {
  if (!WIN) return cmds.join(" && ");
  let out = cmds[cmds.length - 1];
  for (let i = cmds.length - 2; i >= 0; i--) out = `${cmds[i]}; if ($?) { ${out} }`;
  return out;
}

/** ANDROID_HOME для sdkmanager, avdmanager, emulator и Gradle. */
async function withEnv(cmd: string): Promise<string> {
  const sdk = await sdkRoot();
  return WIN ? `$env:ANDROID_HOME=${quote(sdk)}; $env:ANDROID_SDK_ROOT=${quote(sdk)}; ${cmd}` : `export ANDROID_HOME=${quote(sdk)} ANDROID_SDK_ROOT=${quote(sdk)}; ${cmd}`;
}

export async function fileExists(path: string): Promise<boolean> {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (sep < 0) return false;
  const list = await core.readDir(path.slice(0, sep)).catch(() => null);
  return !!list?.some((e) => e.name.toLowerCase() === path.slice(sep + 1).toLowerCase());
}

// ---------- готовность ----------

export interface Setup {
  java: boolean;
  cmdline: boolean;
  platformTools: boolean;
  platform: boolean;
  buildTools: boolean;
  gradle: boolean;
  emulator: boolean;
}

const [setup, setSetup] = createSignal<Setup | null>(null);
export { setup };

export async function checkSetup(): Promise<Setup> {
  const sdk = await sdkRoot();
  const has = (rel: string) => core.readDir(joinPath(sdk, rel)).then((l) => l.length > 0, () => false);
  const [java, cmdline, platformTools, platform, buildTools, gradle, emulator] = await Promise.all([
    core.agentRun("java -version", 20).then((r) => r.code === 0, () => false),
    cmdlineBin("sdkmanager").then(fileExists),
    has("platform-tools"),
    has(`platforms/${PLATFORM}`),
    has(`build-tools/${BUILD_TOOLS}`),
    gradlePath().then((p) => (p === "gradle" ? core.agentRun("gradle --version", 60).then((r) => r.code === 0, () => false) : true)),
    has("emulator"),
  ]);
  const s = { java, cmdline, platformTools, platform, buildTools, gradle, emulator };
  setSetup(s);
  return s;
}

export const ready = (s: Setup | null) => !!s && s.java && s.cmdline && s.platformTools && s.platform && s.buildTools && s.gradle;

/** Скачать платформу, build-tools и adb. Лицензии Google принимает сам человек в терминале. */
export async function installSdkPackages(extra: string[] = []) {
  const sdk = await sdkRoot();
  const sdkmanager = await cmdlineBin("sdkmanager");
  const pkgs = ["platform-tools", `platforms;${PLATFORM}`, `build-tools;${BUILD_TOOLS}`, ...extra].map(quote).join(" ");
  await runInTerminal(await withEnv(`${exe(sdkmanager)} --sdk_root=${quote(sdk)} ${pkgs}`), "Android SDK");
  notify("Если в терминале спросят про лицензию Google — прочитайте и ответьте y. Потом нажмите «Проверить».");
}

export async function acceptLicenses() {
  const sdk = await sdkRoot();
  await runInTerminal(await withEnv(`${exe(await cmdlineBin("sdkmanager"))} --sdk_root=${quote(sdk)} --licenses`), "Android SDK");
  notify("Прочитайте лицензии в терминале и ответьте y на каждую, если согласны");
}

// ---------- телефоны ----------

export interface Device {
  serial: string;
  state: string;
  model: string;
  wifi: boolean;
}

export function parseDevices(text: string): Device[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    // В выводе бывают заголовок и служебные строки adb («* daemon started…») — устройства только с состоянием
    .filter((l) => l && !l.startsWith("*") && !/^List of devices/i.test(l) && /^\S+\s+\S+/.test(l))
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      const model = l.match(/model:(\S+)/)?.[1]?.replace(/_/g, " ") ?? (serial.startsWith("emulator-") ? "Эмулятор" : serial);
      return { serial, state, model, wifi: /:\d+$/.test(serial) || serial.includes("._adb-tls-connect") };
    });
}

export async function devices(): Promise<Device[]> {
  const adb = await adbPath();
  if (!(await fileExists(adb))) return [];
  const r = await core.agentRun(`${exe(adb)} devices -l`, 20).catch(() => null);
  return r ? parseDevices(r.output) : [];
}

export async function pairWifi(hostPort: string, code: string) {
  const adb = exe(await adbPath());
  const r = await core.agentRun(`${adb} pair ${hostPort.trim()} ${code.trim()}`, 30);
  if (r.code !== 0 || !/success/i.test(r.output)) throw new Error(r.output.trim() || "не удалось связаться");
}

export async function connectWifi(hostPort: string) {
  const adb = exe(await adbPath());
  const r = await core.agentRun(`${adb} connect ${hostPort.trim()}`, 30);
  if (!/connected/i.test(r.output)) throw new Error(r.output.trim() || "не удалось подключиться");
}

export async function mirror(serial?: string) {
  await runInTerminal(serial ? `scrcpy -s ${serial}` : "scrcpy", "Экран телефона");
}

// ---------- эмулятор ----------

export async function createEmulator() {
  const sdk = await sdkRoot();
  const sdkmanager = exe(await cmdlineBin("sdkmanager"));
  const avdmanager = exe(await cmdlineBin("avdmanager"));
  const cmd = chain([
    `${sdkmanager} --sdk_root=${quote(sdk)} "emulator" ${quote(SYSTEM_IMAGE)}`,
    `${avdmanager} create avd -n ${AVD} -k ${quote(SYSTEM_IMAGE)} -d pixel_7 --force`,
  ]);
  await runInTerminal(await withEnv(cmd), "Эмулятор");
  notify("Скачивается образ телефона (~1.5 ГБ). Когда закончится — нажмите «Запустить эмулятор».");
}

export async function startEmulator() {
  await runInTerminal(await withEnv(`${exe(await emulatorPath())} -avd ${AVD}`), "Эмулятор");
}

// ---------- проекты ----------

export interface Project {
  dir: string;
  name: string;
  appId: string;
  hasWrapper: boolean;
}

export async function findProjects(): Promise<Project[]> {
  const r = root();
  if (!r) return [];
  const out: Project[] = [];
  const check = async (dir: string) => {
    const list = await core.readDir(dir).catch(() => []);
    const names = list.map((e) => e.name);
    if (!names.some((n) => n === "settings.gradle.kts" || n === "settings.gradle") || !names.includes("app")) return;
    const gradle = (await core.readFile(joinPath(dir, "app/build.gradle.kts")).catch(() => "")) || (await core.readFile(joinPath(dir, "app/build.gradle")).catch(() => ""));
    const appId = gradle.match(/applicationId\s*=?\s*["']([\w.]+)["']/)?.[1] ?? "";
    out.push({ dir, name: baseName(dir), appId, hasWrapper: names.includes(WIN ? "gradlew.bat" : "gradlew") });
  };
  await check(r);
  for (const e of await core.readDir(r).catch(() => [])) if (e.isDir && !e.name.startsWith(".") && e.name !== "node_modules") await check(joinPath(r, e.name));
  return out;
}

async function mkdirp(dir: string) {
  const r = root()!;
  const rel = dir.slice(r.length).replace(/^[\\/]+/, "");
  let cur = r;
  for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
    cur = joinPath(cur, part);
    await core.createDir(cur).catch(() => {});
  }
}

export const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^\d+/, "") || "myapp";

/** Создать проект из шаблона внутри открытой папки. */
export async function createProject(t: AppTemplate, title: string): Promise<Project | null> {
  const r = root();
  if (!r) {
    notify("Сначала откройте папку, в которой создать приложение");
    return null;
  }
  const folder = slug(title);
  const dir = joinPath(r, folder);
  if ((await core.readDir(r)).some((e) => e.name === folder)) {
    notify(`Папка ${folder} уже есть — выберите другое имя`);
    return null;
  }
  const appId = `com.tulpar.${folder}`;
  const sdk = await sdkRoot();
  const web = t.id === "webview" ? await collectWeb(r) : {};
  const files = TEMPLATE_FILES(t.id, { title, appId, pkgPath: appId.replace(/\./g, "/"), web });
  files["local.properties"] = `sdk.dir=${sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`;
  for (const [rel, content] of Object.entries(files)) {
    const full = joinPath(dir, rel);
    await mkdirp(full.slice(0, Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\"))));
    await core.writeFile(full, content);
  }
  // Gradle wrapper: проект собирается и без Tulpar, и в Android Studio
  const gradle = await gradlePath();
  await runInTerminal(await withEnv(`cd ${quote(dir)}; ${exe(gradle)} wrapper --gradle-version 8.14.3`), "Android: сборка");
  notify(`Приложение «${title}» создано в папке ${folder}. Готовлю Gradle — затем жмите «Собрать и запустить».`);
  return { dir, name: folder, appId, hasWrapper: false };
}

/** Для WebView-приложения: html/css/js/json/svg из корня проекта. */
async function collectWeb(r: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await core.readDir(r).catch(() => [])) {
    if (e.isDir || !/\.(html|css|js|json|svg|txt)$/i.test(e.name)) continue;
    const text = await core.readFile(joinPath(r, e.name)).catch(() => null);
    if (text != null && text.length < 2_000_000) out[e.name] = text;
  }
  return out;
}

async function gradleCmd(p: Project, task: string) {
  const wrapper = WIN ? ".\\gradlew.bat" : "./gradlew";
  const hasWrapper = (await core.readDir(p.dir).catch(() => [])).some((e) => e.name === (WIN ? "gradlew.bat" : "gradlew"));
  return `${hasWrapper ? (WIN ? `& ${wrapper}` : wrapper) : exe(await gradlePath())} ${task}`;
}

const apkPath = (p: Project, release = false) => joinPath(p.dir, release ? "app/build/outputs/bundle/release/app-release.aab" : "app/build/outputs/apk/debug/app-debug.apk");

export async function build(p: Project) {
  await runInTerminal(await withEnv(`cd ${quote(p.dir)}; ${await gradleCmd(p, "assembleDebug")}`), "Android: сборка");
}

/** Собрать → поставить на телефон → открыть. */
export async function buildAndRun(p: Project, serial?: string) {
  const adb = exe(await adbPath());
  const target = serial ? ` -s ${serial}` : "";
  const cmds = [`cd ${quote(p.dir)}`, await gradleCmd(p, "assembleDebug"), `${adb}${target} install -r ${quote(apkPath(p))}`];
  if (p.appId) cmds.push(`${adb}${target} shell monkey -p ${p.appId} -c android.intent.category.LAUNCHER 1`);
  await runInTerminal(await withEnv(chain(cmds)), "Android: сборка");
}

export async function buildRelease(p: Project) {
  await runInTerminal(await withEnv(`cd ${quote(p.dir)}; ${await gradleCmd(p, "bundleRelease")}`), "Android: сборка");
  notify("Файл для Google Play (.aab) появится в app/build/outputs/bundle/release");
}

/** Ключ подписи: keytool спросит пароль и данные прямо в терминале — Tulpar их не видит. */
export async function createSigningKey(p: Project) {
  const ks = joinPath(p.dir, "release.keystore");
  await runInTerminal(`keytool -genkeypair -v -keystore ${quote(ks)} -alias release -keyalg RSA -keysize 2048 -validity 10000`, "Android: ключ");
  const propsPath = joinPath(p.dir, "keystore.properties");
  if (!(await fileExists(propsPath))) {
    await core.writeFile(propsPath, "# Пароли от release.keystore — впишите те, что вводили в терминале.\n# Файл не попадёт в git (.gitignore).\nstoreFile=../release.keystore\nstorePassword=\nkeyAlias=release\nkeyPassword=\n");
  }
  const { openFile } = await import("../editor/tabs");
  void openFile(propsPath);
  notify("Создайте ключ в терминале, затем впишите пароли в keystore.properties. Храните ключ: без него нельзя обновить приложение в Google Play.");
}

export async function openApkFolder(p: Project) {
  const dir = joinPath(p.dir, "app/build/outputs/apk/debug");
  const opener = WIN ? "explorer" : OS === "mac" ? "open" : "xdg-open";
  await core.agentRun(`${opener} ${quote(dir)}`, 15).catch(() => notify(dir));
}

// ---------- журнал телефона ----------

export interface LogcatLine {
  time: string;
  level: "error" | "warn" | "info" | "debug";
  tag: string;
  text: string;
}

const LEVEL: Record<string, LogcatLine["level"]> = { E: "error", F: "error", W: "warn", I: "info", D: "debug", V: "debug" };

/** Формат threadtime: «11-17 14:21:01.123  1234  1250 E Tag: сообщение». */
export function parseLogcat(text: string): LogcatLine[] {
  const out: LogcatLine[] = [];
  for (const l of text.split(/\r?\n/)) {
    const m = l.match(/^(\d\d-\d\d \d\d:\d\d:\d\d)\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]*?)\s*:\s?(.*)$/);
    if (m) out.push({ time: m[1], level: LEVEL[m[2]] ?? "info", tag: m[3], text: m[4] });
    else if (out.length && l.trim()) out[out.length - 1].text += "\n" + l;
  }
  return out;
}

export async function logcat(serial?: string, onlyWarnings = true): Promise<LogcatLine[]> {
  const adb = exe(await adbPath());
  const r = await core.agentRun(`${adb}${serial ? ` -s ${serial}` : ""} logcat -d -t 500 -v threadtime${onlyWarnings ? " *:W" : ""}`, 30);
  return parseLogcat(r.output);
}

export async function clearLogcat(serial?: string) {
  const adb = exe(await adbPath());
  await core.agentRun(`${adb}${serial ? ` -s ${serial}` : ""} logcat -c`, 15).catch((e) => notifyError("logcat", e));
}
