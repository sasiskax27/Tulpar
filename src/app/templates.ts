// Шаблоны новых проектов для стартового экрана. Простые проекты Tulpar
// создаёт сам (пишет файлы), для React, Flutter и .NET запускает их
// штатные генераторы в терминале.
import { core } from "../ipc";
import { open } from "../i18n/dialog";
import { askInput } from "./InputBox";
import { openFolder } from "./workspace";
import { openFile } from "../editor/tabs";
import { runInTerminal } from "../terminal/sessions";
import { andThen } from "../tasks/tasks";
import { notifyError } from "./notify";

export interface Template {
  id: string;
  title: string;
  hint: string;
  /** Цвет значка */
  color: string;
  badge: string;
  files?: (name: string) => Record<string, string>;
  command?: (name: string) => string;
  /** Какой файл открыть после создания */
  main?: string;
}

const ident = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "app";
const dash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";

const GITIGNORE_COMMON = "# Системные и редакторские файлы\n.DS_Store\nThumbs.db\n.vscode/\n.idea/\n";

export const TEMPLATES: Template[] = [
  {
    id: "python",
    title: "Python",
    hint: "Скрипт с main()",
    color: "#3B82C4",
    badge: "Py",
    main: "main.py",
    files: (name) => ({
      "main.py": `"""${name}"""\n\n\ndef main() -> None:\n    print("Привет из ${name}!")\n\n\nif __name__ == "__main__":\n    main()\n`,
      "requirements.txt": "",
      ".gitignore": GITIGNORE_COMMON + "__pycache__/\n*.pyc\n.venv/\nvenv/\n.env\n",
    }),
  },
  {
    id: "web",
    title: "Сайт",
    hint: "HTML, CSS и JavaScript",
    color: "#E2603B",
    badge: "</>",
    main: "index.html",
    files: (name) => ({
      "index.html": `<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main>\n    <h1>${name}</h1>\n    <p>Откройте предпросмотр справа — страница обновляется сама.</p>\n    <button id="hello">Нажми меня</button>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
      "style.css": `* { box-sizing: border-box; }\n\nbody {\n  margin: 0;\n  min-height: 100vh;\n  display: grid;\n  place-items: center;\n  font-family: system-ui, sans-serif;\n  background: #0f1220;\n  color: #e8eaf2;\n}\n\nbutton {\n  padding: 10px 18px;\n  border: 0;\n  border-radius: 999px;\n  background: #f0b840;\n  color: #1a1406;\n  font-weight: 600;\n  cursor: pointer;\n}\n`,
      "script.js": `document.getElementById("hello").addEventListener("click", () => {\n  alert("Привет!");\n});\n`,
    }),
  },
  {
    id: "react",
    title: "React",
    hint: "Vite + TypeScript",
    color: "#2FB8D6",
    badge: "⚛",
    command: () => andThen("npm create vite@latest . -- --template react-ts", "npm install"),
  },
  {
    id: "node",
    title: "Node.js",
    hint: "Программа на JavaScript",
    color: "#5FA04E",
    badge: "JS",
    main: "index.js",
    files: (name) => ({
      "package.json": JSON.stringify({ name: dash(name), version: "1.0.0", type: "module", main: "index.js", scripts: { start: "node index.js", dev: "node --watch index.js" } }, null, 2) + "\n",
      "index.js": `console.log("Привет из ${name}!");\n`,
      ".gitignore": GITIGNORE_COMMON + "node_modules/\n.env\n",
    }),
  },
  {
    id: "java",
    title: "Java",
    hint: "Maven-проект",
    color: "#E76F00",
    badge: "J",
    main: "src/main/java/app/Main.java",
    files: (name) => ({
      "pom.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0"\n         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">\n    <modelVersion>4.0.0</modelVersion>\n\n    <groupId>app</groupId>\n    <artifactId>${dash(name)}</artifactId>\n    <version>1.0-SNAPSHOT</version>\n\n    <properties>\n        <maven.compiler.release>21</maven.compiler.release>\n        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n        <exec.mainClass>app.Main</exec.mainClass>\n    </properties>\n\n    <dependencies>\n    </dependencies>\n</project>\n`,
      "src/main/java/app/Main.java": `package app;\n\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Привет из ${name}!");\n    }\n}\n`,
      ".gitignore": GITIGNORE_COMMON + "target/\n*.class\n",
    }),
  },
  {
    id: "rust",
    title: "Rust",
    hint: "Cargo-проект",
    color: "#CE6A3A",
    badge: "Rs",
    main: "src/main.rs",
    files: (name) => ({
      "Cargo.toml": `[package]\nname = "${dash(name)}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`,
      "src/main.rs": `fn main() {\n    println!("Привет из ${name}!");\n}\n`,
      ".gitignore": GITIGNORE_COMMON + "/target\n",
    }),
  },
  {
    id: "go",
    title: "Go",
    hint: "Модуль Go",
    color: "#00ADD8",
    badge: "Go",
    main: "main.go",
    files: (name) => ({
      "go.mod": `module ${dash(name)}\n\ngo 1.22\n`,
      "main.go": `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Привет из ${name}!")\n}\n`,
    }),
  },
  {
    id: "cpp",
    title: "C++",
    hint: "CMake",
    color: "#6A8FD6",
    badge: "C++",
    main: "main.cpp",
    files: (name) => ({
      "CMakeLists.txt": `cmake_minimum_required(VERSION 3.16)\nproject(${ident(name)} CXX)\n\nset(CMAKE_CXX_STANDARD 20)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\n\nadd_executable(${ident(name)} main.cpp)\n`,
      "main.cpp": `#include <iostream>\n\nint main() {\n    std::cout << "Привет из ${name}!" << std::endl;\n    return 0;\n}\n`,
      ".gitignore": GITIGNORE_COMMON + "build/\n",
    }),
  },
  {
    id: "flutter",
    title: "Flutter",
    hint: "Приложение для телефона",
    color: "#47C5FB",
    badge: "F",
    command: (name) => `flutter create --project-name ${ident(name)} .`,
  },
  {
    id: "csharp",
    title: "C#",
    hint: ".NET, консоль",
    color: "#9B6BD6",
    badge: "C#",
    command: () => "dotnet new console",
  },
];

/** Создать проект: выбрать, куда положить, назвать, создать файлы и открыть. */
export async function createProject(t: Template | null, suggested = "my-app"): Promise<boolean> {
  const parent = await open({ directory: true, title: "Где создать проект" });
  if (typeof parent !== "string") return false;
  const name = await askInput({ title: "Название проекта", placeholder: "Например: my-app", value: suggested });
  if (!name) return false;
  try {
    const dir = await core.projectCreate(parent, name.trim());
    if (!(await openFolder(dir))) return false;
    const sep = dir.includes("\\") ? "\\" : "/";
    const files = t?.files?.(name.trim()) ?? {};
    for (const [rel, content] of Object.entries(files)) {
      await core.agentWrite(dir + sep + rel.replace(/\//g, sep), content);
    }
    if (t?.main && files[t.main] !== undefined) await openFile(dir + sep + t.main.replace(/\//g, sep));
    if (t?.command) await runInTerminal(t.command(name.trim()), "Новый проект");
    return true;
  } catch (e) {
    notifyError("Не удалось создать проект", e);
    return false;
  }
}
