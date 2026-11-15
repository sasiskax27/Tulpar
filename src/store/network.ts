// 📂 Общие папки (SMB/Samba) на этом компьютере.
import { core } from "../ipc";
import { runInTerminal } from "../terminal/sessions";
import { OS } from "./platform";

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Открыть папку проекта по сети (Windows спросит права администратора). */
export async function shareFolder(path: string, name: string) {
  const n = name.replace(/[^\w-]/g, "") || "Tulpar";
  if (OS === "windows") {
    const inner = `New-SmbShare -Name ${psq(n)} -Path ${psq(path)} -FullAccess $env:USERNAME; Write-Host ''; Write-Host ('Готово: \\\\' + $env:COMPUTERNAME + '\\${n}'); Read-Host 'Enter — закрыть'`;
    await runInTerminal(`Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command',${psq(inner)}`, "Общая папка");
  } else if (OS === "mac") {
    await runInTerminal(`sudo sharing -a ${JSON.stringify(path)} -S ${n} -s 001`, "Общая папка");
  } else {
    await runInTerminal(`net usershare add ${n} ${JSON.stringify(path)} "Tulpar" Everyone:F guest_ok=n || echo "Нужен пакет samba: sudo apt install samba"`, "Общая папка");
  }
}

export async function unshareFolder(name: string) {
  const n = name.replace(/[^\w-]/g, "") || "Tulpar";
  if (OS === "windows") {
    const inner = `Remove-SmbShare -Name ${psq(n)} -Force; Read-Host 'Готово. Enter — закрыть'`;
    await runInTerminal(`Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command',${psq(inner)}`, "Общая папка");
  } else if (OS === "linux") await runInTerminal(`net usershare delete ${n}`, "Общая папка");
  else await runInTerminal(`sudo sharing -r ${n}`, "Общая папка");
}

/** Открыть общую папку другого компьютера/сервера: \\host\share или smb://host/share. */
export async function openShare(address: string) {
  const a = address.trim().replace(/^smb:\/\//i, "").replace(/^\\\\/, "").replace(/\\/g, "/");
  if (!a) return;
  if (OS === "windows") await core.openUrl(`\\\\${a.replace(/\//g, "\\")}`);
  else await core.openUrl(`smb://${a}`);
}

/** Подключить как диск Z: (Windows спросит логин и пароль в терминале). */
export async function mapDrive(address: string, letter = "Z") {
  const a = address.trim().replace(/^smb:\/\//i, "").replace(/^\\\\/, "").replace(/\//g, "\\");
  await runInTerminal(`net use ${letter}: \\\\${a} /persistent:yes`, "Сетевой диск");
}
