// Библиотеки проекта: какой менеджер пакетов у проекта, что уже подключено,
// как добавить и убрать библиотеку. Установка — штатной командой языка в
// терминале (npm install, cargo add, pip install…), а для Maven и Gradle
// зависимость дописывается прямо в pom.xml / build.gradle.
import { core, type DirEntry } from "../ipc";
import { root } from "../app/workspace";
import { runInTerminal } from "../terminal/sessions";
import { modelFor } from "../editor/tabs";

export type Registry = "npm" | "pypi" | "crates" | "maven" | "nuget" | "go" | "pub" | "packagist" | "rubygems";

export const REGISTRIES: { id: Registry; label: string; lang: string }[] = [
  { id: "npm", label: "npm", lang: "JavaScript / TypeScript" },
  { id: "pypi", label: "PyPI", lang: "Python" },
  { id: "crates", label: "crates.io", lang: "Rust" },
  { id: "maven", label: "Maven", lang: "Java / Kotlin" },
  { id: "nuget", label: "NuGet", lang: "C# / .NET" },
  { id: "go", label: "Go", lang: "Go" },
  { id: "pub", label: "pub.dev", lang: "Dart / Flutter" },
  { id: "packagist", label: "Packagist", lang: "PHP" },
  { id: "rubygems", label: "RubyGems", lang: "Ruby" },
];

export interface Dep {
  name: string;
  version: string;
  dev?: boolean;
}

export interface Manager {
  /** npm, pnpm, pip, poetry, uv, cargo, maven, gradle, go, dotnet, flutter, dart, composer, bundler */
  id: string;
  label: string;
  registry: Registry;
  file: string;
  /** Есть ли разделение на обычные и dev-зависимости */
  dev: boolean;
}

const sep = (dir: string) => (dir.includes("\\") ? "\\" : "/");
const join = (dir: string, name: string) => dir + sep(dir) + name;

async function read(path: string): Promise<string | null> {
  // Открытый в редакторе файл может быть свежее, чем на диске
  const model = modelFor(path);
  if (model) return model.getValue();
  try {
    return await core.readFile(path);
  } catch {
    return null;
  }
}

/** Менеджеры пакетов в корне открытого проекта. */
export async function detectManagers(): Promise<Manager[]> {
  const r = root();
  if (!r) return [];
  let entries: DirEntry[];
  try {
    entries = await core.readDir(r);
  } catch {
    return [];
  }
  const has = (n: string) => entries.some((e) => e.name === n);
  const find = (ext: string) => entries.find((e) => !e.isDir && e.name.toLowerCase().endsWith(ext))?.name;
  const out: Manager[] = [];
  if (has("package.json")) {
    const id = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
    out.push({ id, label: id, registry: "npm", file: "package.json", dev: true });
  }
  if (has("pyproject.toml") || has("requirements.txt") || find(".py")) {
    const py = has("pyproject.toml") ? (await read(join(r, "pyproject.toml"))) ?? "" : "";
    if (has("uv.lock")) out.push({ id: "uv", label: "uv", registry: "pypi", file: "pyproject.toml", dev: true });
    else if (/\[tool\.poetry\]/.test(py)) out.push({ id: "poetry", label: "Poetry", registry: "pypi", file: "pyproject.toml", dev: true });
    else out.push({ id: "pip", label: "pip", registry: "pypi", file: has("requirements.txt") ? "requirements.txt" : "", dev: false });
  }
  if (has("Cargo.toml")) out.push({ id: "cargo", label: "Cargo", registry: "crates", file: "Cargo.toml", dev: true });
  if (has("pom.xml")) out.push({ id: "maven", label: "Maven", registry: "maven", file: "pom.xml", dev: true });
  const gradle = has("build.gradle.kts") ? "build.gradle.kts" : has("build.gradle") ? "build.gradle" : null;
  if (gradle) out.push({ id: "gradle", label: "Gradle", registry: "maven", file: gradle, dev: true });
  if (has("go.mod")) out.push({ id: "go", label: "Go modules", registry: "go", file: "go.mod", dev: false });
  const csproj = find(".csproj") ?? find(".fsproj");
  if (csproj) out.push({ id: "dotnet", label: ".NET", registry: "nuget", file: csproj, dev: false });
  if (has("pubspec.yaml")) {
    const spec = (await read(join(r, "pubspec.yaml"))) ?? "";
    const flutter = /sdk:\s*flutter/.test(spec);
    out.push({ id: flutter ? "flutter" : "dart", label: flutter ? "Flutter" : "Dart", registry: "pub", file: "pubspec.yaml", dev: true });
  }
  if (has("composer.json")) out.push({ id: "composer", label: "Composer", registry: "packagist", file: "composer.json", dev: true });
  if (has("Gemfile")) out.push({ id: "bundler", label: "Bundler", registry: "rubygems", file: "Gemfile", dev: false });
  return out;
}

/** Менеджер по умолчанию для реестра, если в проекте его нет (только где это имеет смысл). */
export function fallbackManager(registry: Registry): Manager | null {
  if (registry === "pypi") return { id: "pip", label: "pip", registry, file: "", dev: false };
  if (registry === "npm") return { id: "npm", label: "npm", registry, file: "package.json", dev: true };
  return null;
}

// ---------- что уже подключено ----------

function section(text: string, header: RegExp): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => header.test(l.trim()));
  if (start < 0) return "";
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\s*\[/.test(l)) break;
    body.push(l);
  }
  return body.join("\n");
}

function tomlDeps(text: string, header: RegExp, dev = false): Dep[] {
  const out: Dep[] = [];
  for (const l of section(text, header).split("\n")) {
    const m = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(l);
    if (!m) continue;
    const v = /^"([^"]*)"/.exec(m[2].trim())?.[1] ?? /version\s*=\s*"([^"]*)"/.exec(m[2])?.[1] ?? "";
    out.push({ name: m[1], version: v, dev });
  }
  return out;
}

/** «requests>=2.0» → { name, version } */
function pep508(spec: string): Dep | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/.exec(spec);
  if (!m) return null;
  return { name: m[1], version: m[3].split(";")[0].trim() };
}

export async function installedDeps(m: Manager): Promise<Dep[]> {
  const r = root();
  if (!r || !m.file) return [];
  const text = await read(join(r, m.file));
  if (text === null) return [];
  try {
    switch (m.id) {
      case "npm":
      case "pnpm":
      case "yarn":
      case "bun": {
        const pkg = JSON.parse(text);
        return [
          ...Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({ name, version: String(version) })),
          ...Object.entries(pkg.devDependencies ?? {}).map(([name, version]) => ({ name, version: String(version), dev: true })),
        ];
      }
      case "pip":
        return text
          .split(/\r?\n/)
          .map((l) => l.replace(/#.*/, "").trim())
          .filter((l) => l && !l.startsWith("-"))
          .map(pep508)
          .filter((d): d is Dep => !!d);
      case "uv":
      case "poetry": {
        const poetry = [...tomlDeps(text, /^\[tool\.poetry\.dependencies\]$/), ...tomlDeps(text, /^\[tool\.poetry\.(group\.dev\.)?dev-dependencies\]$|^\[tool\.poetry\.group\.dev\.dependencies\]$/, true)];
        if (poetry.length) return poetry.filter((d) => d.name !== "python");
        // PEP 621: dependencies = [ "a>=1", "b" ]
        const list = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text)?.[1] ?? "";
        return [...list.matchAll(/["']([^"']+)["']/g)].map((x) => pep508(x[1])).filter((d): d is Dep => !!d);
      }
      case "cargo":
        return [...tomlDeps(text, /^\[dependencies\]$/), ...tomlDeps(text, /^\[dev-dependencies\]$/, true)];
      case "maven":
        return [...text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].map((x) => {
          const tag = (t: string) => new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`).exec(x[1])?.[1] ?? "";
          return { name: `${tag("groupId")}:${tag("artifactId")}`, version: tag("version"), dev: tag("scope") === "test" };
        });
      case "gradle":
        return [...text.matchAll(/^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*["']([^"':]+:[^"':]+)(?::([^"']+))?["']/gm)].map((x) => ({
          name: x[2],
          version: x[3] ?? "",
          dev: x[1] === "testImplementation",
        }));
      case "go":
        return [...text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+(v[^\s]+)(\s*\/\/\s*indirect)?/gm)]
          .filter((x) => !x[3])
          .map((x) => ({ name: x[1], version: x[2] }));
      case "dotnet":
        return [...text.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]*)")?/g)].map((x) => ({ name: x[1], version: x[2] ?? "" }));
      case "flutter":
      case "dart": {
        const out: Dep[] = [];
        let dev = false;
        let inDeps = false;
        for (const l of text.split(/\r?\n/)) {
          if (/^dependencies:/.test(l)) (inDeps = true), (dev = false);
          else if (/^dev_dependencies:/.test(l)) (inDeps = true), (dev = true);
          else if (/^\S/.test(l)) inDeps = false;
          else if (inDeps) {
            const m = /^ {2}([a-z0-9_]+):\s*(.*)$/.exec(l);
            if (m && m[1] !== "flutter" && m[1] !== "flutter_test") out.push({ name: m[1], version: m[2].trim(), dev });
          }
        }
        return out;
      }
      case "composer": {
        const c = JSON.parse(text);
        return [
          ...Object.entries(c.require ?? {}).map(([name, version]) => ({ name, version: String(version) })),
          ...Object.entries(c["require-dev"] ?? {}).map(([name, version]) => ({ name, version: String(version), dev: true })),
        ].filter((d) => d.name !== "php" && !d.name.startsWith("ext-"));
      }
      case "bundler":
        return [...text.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)].map((x) => ({ name: x[1], version: x[2] ?? "" }));
    }
  } catch {
    /* файл с ошибкой — показываем пустой список */
  }
  return [];
}

// ---------- добавить и убрать ----------

const PYTHON = navigator.userAgent.includes("Windows") ? "python" : "python3";

function quoteArg(s: string) {
  return /^[A-Za-z0-9@/._:=<>~^+-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
}

/** Команда установки. null — менеджер правит файл сам (Maven, Gradle). */
export function addCommand(m: Manager, name: string, dev: boolean): string | null {
  const n = quoteArg(name);
  switch (m.id) {
    case "npm": return `npm install ${dev ? "-D " : ""}${n}`;
    case "pnpm": return `pnpm add ${dev ? "-D " : ""}${n}`;
    case "yarn": return `yarn add ${dev ? "-D " : ""}${n}`;
    case "bun": return `bun add ${dev ? "-d " : ""}${n}`;
    case "pip": return `${PYTHON} -m pip install ${n}`;
    case "uv": return `uv add ${dev ? "--dev " : ""}${n}`;
    case "poetry": return `poetry add ${dev ? "--group dev " : ""}${n}`;
    case "cargo": return `cargo add ${dev ? "--dev " : ""}${n}`;
    case "go": return `go get ${n}@latest`;
    case "dotnet": return `dotnet add package ${n}`;
    case "flutter": return `flutter pub add ${dev ? "--dev " : ""}${n}`;
    case "dart": return `dart pub add ${dev ? "--dev " : ""}${n}`;
    case "composer": return `composer require ${dev ? "--dev " : ""}${n}`;
    case "bundler": return `bundle add ${n}`;
  }
  return null;
}

export function removeCommand(m: Manager, name: string): string | null {
  const n = quoteArg(name);
  switch (m.id) {
    case "npm": return `npm uninstall ${n}`;
    case "pnpm":
    case "yarn":
    case "bun": return `${m.id} remove ${n}`;
    case "pip": return `${PYTHON} -m pip uninstall -y ${n}`;
    case "uv":
    case "poetry": return `${m.id} remove ${n}`;
    case "cargo": return `cargo remove ${n}`;
    case "go": return `go get ${n}@none`;
    case "dotnet": return `dotnet remove package ${n}`;
    case "flutter":
    case "dart": return `${m.id} pub remove ${n}`;
    case "composer": return `composer remove ${n}`;
    case "bundler": return `bundle remove ${n}`;
  }
  return null;
}

/** Вставить зависимость Maven в pom.xml. */
export function pomAdd(text: string, ga: string, version: string, test: boolean): string {
  const [g, a] = ga.split(":");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const block = (ind: string, unit: string) =>
    [
      `${ind}${unit}<dependency>`,
      `${ind}${unit}${unit}<groupId>${g}</groupId>`,
      `${ind}${unit}${unit}<artifactId>${a}</artifactId>`,
      version ? `${ind}${unit}${unit}<version>${version}</version>` : "",
      test ? `${ind}${unit}${unit}<scope>test</scope>` : "",
      `${ind}${unit}</dependency>`,
    ]
      .filter(Boolean)
      .join(nl);
  // Вне <dependencyManagement>: ищем последний </dependencies>
  const managed = /<dependencyManagement>[\s\S]*?<\/dependencyManagement>/.exec(text);
  let idx = -1;
  const re = /<\/dependencies>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (managed && m.index > managed.index && m.index < managed.index + managed[0].length) continue;
    idx = m.index;
  }
  if (idx >= 0) {
    const lineStart = text.lastIndexOf("\n", idx) + 1;
    const ind = text.slice(lineStart, idx).match(/^[ \t]*/)![0];
    const unit = ind.includes("\t") ? "\t" : ind.length && ind.length % 4 === 0 ? "    " : "  ";
    return text.slice(0, lineStart) + block(ind, unit) + nl + text.slice(lineStart);
  }
  const dep = block("    ", "    ");
  const end = text.lastIndexOf("</project>");
  if (end < 0) throw new Error("в pom.xml нет </project>");
  return text.slice(0, end) + `    <dependencies>${nl}${dep}${nl}    </dependencies>${nl}` + text.slice(end);
}

export function pomRemove(text: string, ga: string): string {
  const [g, a] = ga.split(":");
  return text.replace(/[ \t]*<dependency>([\s\S]*?)<\/dependency>[ \t]*\r?\n?/g, (block, inner: string) =>
    new RegExp(`<groupId>\\s*${esc(g)}\\s*</groupId>`).test(inner) && new RegExp(`<artifactId>\\s*${esc(a)}\\s*</artifactId>`).test(inner) ? "" : block,
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Вставить зависимость в build.gradle(.kts). */
export function gradleAdd(text: string, kts: boolean, coord: string, test: boolean): string {
  const conf = test ? "testImplementation" : "implementation";
  const line = kts ? `    ${conf}("${coord}")` : `    ${conf} '${coord}'`;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  // Верхнеуровневый блок dependencies { — не внутри buildscript
  const re = /^dependencies\s*\{/m;
  const m = re.exec(text);
  if (!m) return text.replace(/\s*$/, "") + `${nl}${nl}dependencies {${nl}${line}${nl}}${nl}`;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      const lineStart = text.lastIndexOf("\n", i) + 1;
      return text.slice(0, lineStart) + line + nl + text.slice(lineStart);
    }
  }
  throw new Error("не нашёл конец блока dependencies");
}

export function gradleRemove(text: string, ga: string): string {
  return text.replace(new RegExp(`^[ \\t]*\\w+\\s*\\(?\\s*["']${esc(ga)}(:[^"']*)?["']\\s*\\)?[ \\t]*\\r?\\n`, "gm"), "");
}

/** Добавить библиотеку в проект. */
export async function addDependency(m: Manager, name: string, version: string, dev: boolean) {
  const r = root();
  if ((m.id === "maven" || m.id === "gradle") && r) {
    const path = join(r, m.file);
    const text = (await read(path)) ?? "";
    const next = m.id === "maven" ? pomAdd(text, name, version, dev) : gradleAdd(text, m.file.endsWith(".kts"), `${name}${version ? ":" + version : ""}`, dev);
    await writeBack(path, next);
    return `Добавлено в ${m.file}: ${name}${version ? " " + version : ""}`;
  }
  const cmd = addCommand(m, name, dev);
  if (!cmd) throw new Error("этот менеджер пакетов не поддерживается");
  await runInTerminal(cmd, "Библиотеки");
  // pip: дописываем в requirements.txt, если он есть
  if (m.id === "pip" && m.file && r) {
    const path = join(r, m.file);
    const text = (await read(path)) ?? "";
    const exists = text.split(/\r?\n/).some((l) => pep508(l)?.name.toLowerCase() === name.toLowerCase());
    if (!exists) await writeBack(path, text.replace(/\s*$/, "") + (text.trim() ? "\n" : "") + name + "\n");
  }
  return null;
}

export async function removeDependency(m: Manager, name: string) {
  const r = root();
  if ((m.id === "maven" || m.id === "gradle") && r) {
    const path = join(r, m.file);
    const text = (await read(path)) ?? "";
    await writeBack(path, m.id === "maven" ? pomRemove(text, name) : gradleRemove(text, name));
    return;
  }
  const cmd = removeCommand(m, name);
  if (cmd) await runInTerminal(cmd, "Библиотеки");
  if (m.id === "pip" && m.file && r) {
    const path = join(r, m.file);
    const text = (await read(path)) ?? "";
    const next = text
      .split(/(\r?\n)/)
      .filter((l) => pep508(l.replace(/#.*/, ""))?.name.toLowerCase() !== name.toLowerCase())
      .join("");
    if (next !== text) await writeBack(path, next);
  }
}

async function writeBack(path: string, text: string) {
  const model = modelFor(path);
  // Открытый файл правим в редакторе — правку можно отменить Ctrl+Z, файл сохраняем
  if (model) {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  }
  await core.writeFile(path, text);
}
