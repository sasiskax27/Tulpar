// VM Studio: список машин, сборка аргументов QEMU, снимки.
import { createSignal } from "solid-js";
import { core, joinPath } from "../ipc";
import { notify, notifyError } from "../app/notify";
import { OS, systemInstall } from "../store/platform";

export interface Vm {
  id: string;
  name: string;
  template: string;
  ramMb: number;
  cpus: number;
  diskGb: number;
  disk: string;
  iso: string;
  /** Порт на этом компьютере, проброшенный на 22 порт машины (ssh -p …) */
  sshPort: number;
}

export interface Template {
  id: string;
  name: string;
  icon: string;
  ramMb: number;
  cpus: number;
  diskGb: number;
  isoPage: string;
  note: string;
}

export const TEMPLATES: Template[] = [
  { id: "ubuntu", name: "Ubuntu", icon: "🟠", ramMb: 4096, cpus: 2, diskGb: 30, isoPage: "https://ubuntu.com/download/desktop", note: "Самый популярный Linux для начала." },
  { id: "debian", name: "Debian", icon: "🌀", ramMb: 2048, cpus: 2, diskGb: 20, isoPage: "https://www.debian.org/distrib/", note: "Стабильный Linux для серверов." },
  { id: "alpine", name: "Alpine", icon: "🏔", ramMb: 512, cpus: 1, diskGb: 4, isoPage: "https://alpinelinux.org/downloads/", note: "Крошечный Linux: запускается за секунды." },
  { id: "windows", name: "Windows 11", icon: "🪟", ramMb: 8192, cpus: 4, diskGb: 64, isoPage: "https://www.microsoft.com/software-download/windows11", note: "Нужно много памяти и место на диске." },
  { id: "other", name: "Другая ОС", icon: "💿", ramMb: 2048, cpus: 2, diskGb: 20, isoPage: "", note: "Любой ISO-образ." },
];

const KEY = "tulpar.vms";
const load = (): Vm[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};
const [vms, setVmsRaw] = createSignal<Vm[]>(load());
const [status, setStatus] = createSignal<Record<string, string>>({});
export { vms, status };

function setVms(list: Vm[]) {
  setVmsRaw(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* хранилище недоступно — список живёт до перезапуска */
  }
}

export async function refreshStatus() {
  try {
    const s = await core.vmStatus();
    // Упавшие с ошибкой показываем один раз
    for (const [id, st] of Object.entries(s) as [string, string][]) {
      if (st.startsWith("error:")) notifyError(`Машина ${vms().find((v) => v.id === id)?.name ?? id} остановилась`, st.slice(6) || "QEMU завершился с ошибкой");
    }
    setStatus(s);
  } catch {
    /* ignore */
  }
}

export async function installQemu() {
  const { runInTerminal } = await import("../terminal/sessions");
  const cmd =
    OS === "windows"
      ? "winget install --id SoftwareFreedomConservancy.QEMU -e"
      : await systemInstall({ apt: "qemu-system-x86 qemu-utils", dnf: "qemu-kvm qemu-img", pacman: "qemu-full", zypper: "qemu", brew: "qemu" });
  if (!cmd) return notify("Установите QEMU с qemu.org/download");
  void runInTerminal(cmd, "QEMU");
  if (OS === "windows") notify("После установки перезапустите Tulpar, чтобы он увидел QEMU (C:\\Program Files\\qemu)");
}

export async function createVm(t: Template, name: string, iso: string, ramMb: number, cpus: number, diskGb: number): Promise<Vm | null> {
  const info = await core.vmInfo();
  if (!info.qemu) {
    notify("Сначала установите QEMU");
    return null;
  }
  const id = name.toLowerCase().replace(/[^a-z0-9а-я_-]+/gi, "-").replace(/^-|-$/g, "") || `vm-${Date.now()}`;
  if (vms().some((v) => v.id === id)) {
    notify("Машина с таким именем уже есть");
    return null;
  }
  const disk = joinPath(info.dir, `${id}.qcow2`);
  try {
    await core.vmImg(["create", "-f", "qcow2", disk, `${diskGb}G`]);
  } catch (e) {
    notifyError("Не удалось создать диск", e);
    return null;
  }
  const used = new Set(vms().map((v) => v.sshPort));
  let sshPort = 2222;
  while (used.has(sshPort)) sshPort++;
  const vm: Vm = { id, name, template: t.id, ramMb, cpus, diskGb, disk, iso, sshPort };
  setVms([...vms(), vm]);
  notify(`Машина «${name}» создана. Нажмите ▶, чтобы начать установку ОС.`);
  return vm;
}

export function updateVm(id: string, patch: Partial<Vm>) {
  setVms(vms().map((v) => (v.id === id ? { ...v, ...patch } : v)));
}

export function forgetVm(id: string) {
  setVms(vms().filter((v) => v.id !== id));
}

/** Аргументы QEMU. accel: kvm | whpx | hvf | tcg (без ускорения, медленно). */
export function qemuArgs(vm: Vm, accel: string): string[] {
  const args = ["-name", vm.name, "-m", String(vm.ramMb), "-smp", String(vm.cpus)];
  args.push("-accel", accel === "whpx" ? "whpx,kernel-irqchip=off" : accel);
  if (accel !== "tcg") args.push("-cpu", accel === "whpx" ? "max" : "host");
  args.push("-drive", `file=${vm.disk},format=qcow2`);
  if (vm.iso) args.push("-cdrom", vm.iso, "-boot", "order=dc");
  args.push("-nic", `user,model=e1000,hostfwd=tcp::${vm.sshPort}-:22`);
  args.push("-usb", "-device", "usb-tablet", "-vga", "std");
  return args;
}

export async function startVm(vm: Vm) {
  const info = await core.vmInfo();
  if (!info.qemu) return notify("Сначала установите QEMU");
  const system = "qemu-system-x86_64";
  try {
    await core.vmStart(vm.id, system, qemuArgs(vm, info.accel));
  } catch (e) {
    return notifyError("Не удалось запустить", e);
  }
  // Если ускорение недоступно (выключено в BIOS, нет Hyper-V), QEMU сразу падает —
  // тогда запускаем без ускорения: медленнее, но работает везде
  setTimeout(async () => {
    const s = await core.vmStatus().catch(() => ({}) as Record<string, string>);
    const st = s[vm.id] ?? "";
    if (st.startsWith("error:") && info.accel !== "tcg") {
      notify("Ускорение недоступно — запускаю без него (будет медленнее). Включите виртуализацию в BIOS для скорости.");
      try {
        await core.vmStart(vm.id, system, qemuArgs(vm, "tcg"));
      } catch (e) {
        notifyError("Не удалось запустить", e);
      }
    }
    void refreshStatus();
  }, 2500);
}

export async function stopVm(vm: Vm) {
  await core.vmStop(vm.id).catch((e) => notifyError("Остановка", e));
  void refreshStatus();
}

export interface Snapshot {
  id: string;
  name: string;
  date: string;
}

/** Разбор `qemu-img snapshot -l`: строки «1  name  0 B 2026-11-16 02:00:00 …». */
export function parseSnapshots(text: string): Snapshot[] {
  return text
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\S+)\s+.*?(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ id: m[1], name: m[2], date: m[3] }));
}

export async function snapshots(vm: Vm): Promise<Snapshot[]> {
  return parseSnapshots(await core.vmImg(["snapshot", "-l", vm.disk]));
}

export async function snapshot(vm: Vm, action: "-c" | "-a" | "-d", name: string) {
  if (status()[vm.id] === "running") {
    notify("Сначала остановите машину — снимки делаются, когда она выключена");
    return false;
  }
  try {
    await core.vmImg(["snapshot", action, name, vm.disk]);
    return true;
  } catch (e) {
    notifyError("Снимок", e);
    return false;
  }
}
