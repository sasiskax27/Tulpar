// Иконки файлов в проводнике: цветной значок с подписью типа файла.
// Свои значки для частых файлов (package.json, Dockerfile, .gitignore…) и папок.
import type { JSX } from "solid-js";

interface Badge {
  label: string;
  color: string;
}

const BY_EXT: Record<string, Badge> = {
  py: { label: "py", color: "#3776AB" }, pyw: { label: "py", color: "#3776AB" }, ipynb: { label: "nb", color: "#F37626" },
  js: { label: "js", color: "#D4B830" }, mjs: { label: "js", color: "#D4B830" }, cjs: { label: "js", color: "#D4B830" },
  jsx: { label: "jsx", color: "#61DAFB" }, ts: { label: "ts", color: "#3178C6" }, tsx: { label: "tsx", color: "#3178C6" },
  html: { label: "<>", color: "#E34F26" }, htm: { label: "<>", color: "#E34F26" }, vue: { label: "vue", color: "#42B883" },
  svelte: { label: "sv", color: "#FF3E00" }, css: { label: "#", color: "#663399" }, scss: { label: "#", color: "#CD6799" },
  sass: { label: "#", color: "#CD6799" }, less: { label: "#", color: "#1D365D" }, json: { label: "{}", color: "#CBAA2B" },
  jsonc: { label: "{}", color: "#CBAA2B" }, md: { label: "M↓", color: "#519ABA" }, mdx: { label: "M↓", color: "#519ABA" },
  txt: { label: "txt", color: "#8B8B8B" }, rs: { label: "rs", color: "#CE7340" }, go: { label: "go", color: "#00ADD8" },
  java: { label: "J", color: "#E76F00" }, kt: { label: "kt", color: "#7F52FF" }, kts: { label: "kt", color: "#7F52FF" },
  scala: { label: "sc", color: "#DC322F" }, c: { label: "C", color: "#5C6BC0" }, h: { label: "h", color: "#9575CD" },
  cpp: { label: "C++", color: "#00599C" }, cc: { label: "C++", color: "#00599C" }, hpp: { label: "h++", color: "#9575CD" },
  cs: { label: "C#", color: "#68217A" }, fs: { label: "F#", color: "#378BBA" }, php: { label: "php", color: "#777BB4" },
  rb: { label: "rb", color: "#CC342D" }, swift: { label: "sw", color: "#F05138" }, dart: { label: "dt", color: "#0175C2" },
  lua: { label: "lua", color: "#2C2D72" }, r: { label: "R", color: "#276DC3" }, jl: { label: "jl", color: "#9558B2" },
  ex: { label: "ex", color: "#6E4A7E" }, exs: { label: "ex", color: "#6E4A7E" }, hs: { label: "hs", color: "#5D4F85" },
  sh: { label: "$", color: "#4EAA25" }, bash: { label: "$", color: "#4EAA25" }, zsh: { label: "$", color: "#4EAA25" },
  ps1: { label: "ps", color: "#012456" }, bat: { label: "bat", color: "#C1F12E" }, cmd: { label: "bat", color: "#C1F12E" },
  yml: { label: "yml", color: "#CB171E" }, yaml: { label: "yml", color: "#CB171E" }, toml: { label: "tml", color: "#9C4121" },
  xml: { label: "xml", color: "#E37933" }, ini: { label: "ini", color: "#8B8B8B" }, env: { label: "env", color: "#ECD53F" },
  sql: { label: "sql", color: "#E38C00" }, graphql: { label: "gql", color: "#E10098" }, proto: { label: "pb", color: "#4285F4" },
  png: { label: "img", color: "#26A69A" }, jpg: { label: "img", color: "#26A69A" }, jpeg: { label: "img", color: "#26A69A" },
  gif: { label: "img", color: "#26A69A" }, webp: { label: "img", color: "#26A69A" }, svg: { label: "svg", color: "#FFB13B" },
  ico: { label: "ico", color: "#26A69A" }, mp4: { label: "▶", color: "#FF5252" }, webm: { label: "▶", color: "#FF5252" },
  mp3: { label: "♪", color: "#AB47BC" }, wav: { label: "♪", color: "#AB47BC" }, pdf: { label: "pdf", color: "#E53935" },
  zip: { label: "zip", color: "#AFB42B" }, lock: { label: "🔒", color: "#8B8B8B" }, log: { label: "log", color: "#8B8B8B" },
  csv: { label: "csv", color: "#43A047" }, xlsx: { label: "xls", color: "#1D6F42" }, docx: { label: "doc", color: "#2B579A" },
  gradle: { label: "gr", color: "#02303A" }, tf: { label: "tf", color: "#7B42BC" }, nix: { label: "nix", color: "#5277C3" },
  zig: { label: "zig", color: "#F7A41D" }, sol: { label: "sol", color: "#363636" },
};

const BY_NAME: Record<string, Badge> = {
  "package.json": { label: "npm", color: "#CB3837" }, "package-lock.json": { label: "npm", color: "#8B8B8B" },
  "tsconfig.json": { label: "ts", color: "#3178C6" }, "cargo.toml": { label: "rs", color: "#CE7340" },
  "cargo.lock": { label: "rs", color: "#8B8B8B" }, dockerfile: { label: "🐳", color: "#2496ED" },
  "docker-compose.yml": { label: "🐳", color: "#2496ED" }, ".gitignore": { label: "git", color: "#F05032" },
  ".gitattributes": { label: "git", color: "#F05032" }, "readme.md": { label: "i", color: "#519ABA" },
  license: { label: "§", color: "#D4B830" }, makefile: { label: "mk", color: "#6D8086" },
  "cmakelists.txt": { label: "cm", color: "#064F8C" }, "pom.xml": { label: "mvn", color: "#C71A36" },
  "requirements.txt": { label: "pip", color: "#3776AB" }, "pyproject.toml": { label: "py", color: "#3776AB" },
  "go.mod": { label: "go", color: "#00ADD8" }, ".env": { label: "env", color: "#ECD53F" },
  "vite.config.ts": { label: "⚡", color: "#646CFF" }, "build.gradle": { label: "gr", color: "#02303A" },
};

export function badgeFor(name: string): Badge {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith(".env")) return BY_NAME[".env"];
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return BY_EXT[ext] ?? { label: ext.slice(0, 3) || "•", color: "#8B8B8B" };
}

export function FileIcon(props: { name: string }): JSX.Element {
  const b = () => badgeFor(props.name);
  return (
    <span class="file-icon" style={{ "--fi": b().color }} aria-hidden="true">
      {b().label}
    </span>
  );
}

const SPECIAL_FOLDERS: Record<string, string> = {
  src: "#42A5F5", lib: "#42A5F5", app: "#42A5F5", test: "#66BB6A", tests: "#66BB6A", __tests__: "#66BB6A",
  docs: "#29B6F6", doc: "#29B6F6", node_modules: "#8BC34A", ".git": "#F05032", ".github": "#8B8B8B",
  assets: "#FFCA28", public: "#26A69A", static: "#26A69A", images: "#26A69A", img: "#26A69A",
  build: "#FF7043", dist: "#FF7043", target: "#FF7043", out: "#FF7043", config: "#90A4AE", scripts: "#9CCC65",
  components: "#AB47BC", ".vscode": "#2196F3", venv: "#FBC02D", ".venv": "#FBC02D", "src-tauri": "#FFC131",
};

export function folderColor(name: string): string {
  return SPECIAL_FOLDERS[name.toLowerCase()] ?? "var(--tp-gold)";
}
