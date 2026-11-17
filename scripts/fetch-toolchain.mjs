// Полная версия Tulpar: скачать Java (Eclipse Temurin, GPLv2 + Classpath Exception)
// и Gradle (Apache 2.0) в src-tauri/toolchain — их можно распространять внутри
// установщика. Android SDK сюда не кладём: лицензия Google запрещает его
// распространять, Tulpar скачивает его при первой сборке с согласия человека.
//
//   node scripts/fetch-toolchain.mjs [windows|mac|linux]
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const os = process.argv[2] ?? (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux");
const arch = process.arch === "arm64" ? "aarch64" : "x64";
const out = join(import.meta.dirname, "..", "src-tauri", "toolchain");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Имя файла: <вид>@<версия>@<папки с программами>.zip|.tar.gz — так его понимает Tulpar
// («/» внутри пути к папке пишется как «+»)
const items = [
  {
    // Adoptium отдаёт zip для Windows и tar.gz для macOS/Linux
    file: `java@21@${os === "mac" ? "Contents+Home+bin" : "bin"}.${os === "windows" ? "zip" : "tar.gz"}`,
    url: `https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`,
  },
  { file: "gradle@8.14.3@bin.zip", url: "https://services.gradle.org/distributions/gradle-8.14.3-bin.zip" },
];

for (const it of items) {
  const dest = join(out, it.file);
  if (existsSync(dest)) continue;
  process.stdout.write(`⬇ ${it.file} … `);
  const r = await fetch(it.url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${it.url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const zip = buf[0] === 0x50 && buf[1] === 0x4b;
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  if (!zip && !gz) throw new Error(`${it.url}: это не архив — проверьте ссылку`);
  writeFileSync(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(0)} МБ`);
}
console.log(`Готово: ${out}\nТеперь: npm run tauri build -- --config src-tauri/tauri.full.conf.json`);
