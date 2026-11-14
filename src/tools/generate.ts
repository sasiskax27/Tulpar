// 🪄 Готовые служебные файлы под стек проекта: .gitignore, Dockerfile, CI…
import type { Manager } from "../packages/packages";

export type GenId = "gitignore" | "dockerfile" | "dockerignore" | "ci" | "editorconfig" | "readme" | "license" | "compose";

export const GENERATORS: { id: GenId; file: string; label: string; hint: string }[] = [
  { id: "gitignore", file: ".gitignore", label: ".gitignore", hint: "чтобы мусор и секреты не попадали в git" },
  { id: "dockerfile", file: "Dockerfile", label: "Dockerfile", hint: "запуск проекта в контейнере" },
  { id: "dockerignore", file: ".dockerignore", label: ".dockerignore", hint: "что не копировать в образ" },
  { id: "compose", file: "docker-compose.yml", label: "docker-compose.yml", hint: "приложение + база одной командой" },
  { id: "ci", file: ".github/workflows/ci.yml", label: "GitHub Actions CI", hint: "сборка и тесты на каждый push" },
  { id: "editorconfig", file: ".editorconfig", label: ".editorconfig", hint: "одинаковые отступы у всех в команде" },
  { id: "readme", file: "README.md", label: "README.md", hint: "описание проекта и как запустить" },
  { id: "license", file: "LICENSE", label: "Лицензия MIT", hint: "разрешить другим пользоваться кодом" },
];

const IGNORE: Record<string, string[]> = {
  common: ["# Система и редакторы", ".DS_Store", "Thumbs.db", "desktop.ini", ".idea/", ".vscode/*", "!.vscode/extensions.json", "*.swp", "", "# Секреты", ".env", ".env.*", "!.env.example", "*.pem", "*.key", "", "# Логи", "*.log", "logs/"],
  npm: ["# Node", "node_modules/", "dist/", "build/", ".next/", ".nuxt/", ".svelte-kit/", ".vite/", "coverage/", ".turbo/", "npm-debug.log*", "yarn-error.log*", "pnpm-debug.log*"],
  pypi: ["# Python", "__pycache__/", "*.py[cod]", ".venv/", "venv/", "env/", "*.egg-info/", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", ".ipynb_checkpoints/", "dist/", "build/"],
  crates: ["# Rust", "target/", "**/*.rs.bk"],
  maven: ["# Java", "target/", "build/", ".gradle/", "out/", "*.class", "*.jar", "!gradle/wrapper/gradle-wrapper.jar", "hs_err_pid*"],
  go: ["# Go", "bin/", "*.exe", "*.test", "*.out", "vendor/"],
  nuget: ["# .NET", "bin/", "obj/", "*.user", "*.suo", ".vs/", "TestResults/"],
  pub: ["# Dart / Flutter", ".dart_tool/", ".packages", "build/", ".flutter-plugins", ".flutter-plugins-dependencies"],
  packagist: ["# PHP", "vendor/", ".phpunit.result.cache"],
  rubygems: ["# Ruby", ".bundle/", "vendor/bundle/", "log/", "tmp/"],
};

function regs(ms: Manager[]): string[] {
  return [...new Set(ms.map((m) => m.registry))];
}

function gitignore(ms: Manager[]): string {
  const parts = [IGNORE.common.join("\n")];
  for (const r of regs(ms)) if (IGNORE[r]) parts.push(IGNORE[r].join("\n"));
  if (!ms.length) parts.push("# Сборка\ndist/\nbuild/\nout/");
  return parts.join("\n\n") + "\n";
}

function dockerfile(ms: Manager[], name: string): string {
  const id = ms[0]?.id ?? "";
  if (["npm", "pnpm", "yarn", "bun"].includes(id)) {
    const install = id === "pnpm" ? "corepack enable && pnpm install --frozen-lockfile" : id === "yarn" ? "yarn install --frozen-lockfile" : id === "bun" ? "npm i -g bun && bun install" : "npm ci";
    const run = id === "npm" ? "npm" : id;
    return `# Сборка
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lock* ./
RUN ${install}
COPY . .
RUN ${run} run build --if-present

# Запуск
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["${run}", "start"]
`;
  }
  if (["pip", "uv", "poetry"].includes(id)) {
    return `FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
${id === "pip" ? "COPY requirements.txt* ./\nRUN pip install --no-cache-dir -r requirements.txt || true" : id === "uv" ? "RUN pip install --no-cache-dir uv\nCOPY pyproject.toml uv.lock* ./\nRUN uv sync --frozen --no-dev" : "RUN pip install --no-cache-dir poetry && poetry config virtualenvs.create false\nCOPY pyproject.toml poetry.lock* ./\nRUN poetry install --no-root --only main"}
COPY . .
EXPOSE 8000
# Поменяйте на свою точку входа
CMD ["python", "main.py"]
`;
  }
  if (id === "cargo") {
    return `FROM rust:1-slim AS build
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=build /app/target/release/${name} /usr/local/bin/app
CMD ["app"]
`;
  }
  if (id === "go") {
    return `FROM golang:1.23-alpine AS build
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/app .

FROM gcr.io/distroless/static
COPY --from=build /bin/app /app
EXPOSE 8080
ENTRYPOINT ["/app"]
`;
  }
  if (id === "maven" || id === "gradle") {
    const build = id === "maven" ? "RUN mvn -q -DskipTests package" : "RUN gradle build -x test --no-daemon";
    const img = id === "maven" ? "maven:3-eclipse-temurin-21" : "gradle:8-jdk21";
    const jar = id === "maven" ? "target/*.jar" : "build/libs/*.jar";
    return `FROM ${img} AS build
WORKDIR /app
COPY . .
${build}

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/${jar} app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
`;
  }
  if (id === "dotnet") {
    return `FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /out .
EXPOSE 8080
ENTRYPOINT ["dotnet", "${name}.dll"]
`;
  }
  if (id === "composer") return `FROM php:8.3-apache\nCOPY . /var/www/html/\nEXPOSE 80\n`;
  return `# Статический сайт
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;
}

function dockerignore(ms: Manager[]): string {
  const lines = [".git", ".github", ".env", ".env.*", "*.log", "Dockerfile", "docker-compose.yml", ".vscode", ".idea"];
  for (const r of regs(ms)) {
    if (r === "npm") lines.push("node_modules", "dist", "coverage");
    if (r === "pypi") lines.push("__pycache__", ".venv", "venv", ".pytest_cache");
    if (r === "crates" || r === "maven") lines.push("target", "build", ".gradle");
    if (r === "nuget") lines.push("bin", "obj");
  }
  return [...new Set(lines)].join("\n") + "\n";
}

function compose(ms: Manager[]): string {
  const port = ms.some((m) => m.registry === "npm") ? 3000 : ms.some((m) => m.registry === "pypi") ? 8000 : 8080;
  return `services:
  app:
    build: .
    ports:
      - "${port}:${port}"
    env_file: .env
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
    depends_on:
      - db

  db:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
`;
}

function ci(ms: Manager[]): string {
  const steps: string[] = [];
  const id = ms[0]?.id ?? "";
  if (["npm", "pnpm", "yarn", "bun"].includes(id)) {
    if (id === "pnpm") steps.push("      - uses: pnpm/action-setup@v4");
    if (id === "bun") steps.push("      - uses: oven-sh/setup-bun@v2");
    steps.push(`      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: ${id === "bun" ? "npm" : id}`);
    const run = id === "npm" ? "npm" : id;
    steps.push(`      - run: ${id === "npm" ? "npm ci" : `${run} install`}`, `      - run: ${run} run build --if-present`, `      - run: ${run} test --if-present`);
  } else if (["pip", "uv", "poetry"].includes(id)) {
    steps.push("      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'");
    steps.push(id === "pip" ? "      - run: pip install -r requirements.txt pytest || pip install pytest" : id === "uv" ? "      - run: pip install uv && uv sync" : "      - run: pip install poetry && poetry install");
    steps.push(`      - run: ${id === "pip" ? "" : id === "uv" ? "uv run " : "poetry run "}pytest`);
  } else if (id === "cargo") {
    steps.push("      - uses: dtolnay/rust-toolchain@stable", "      - uses: Swatinem/rust-cache@v2", "      - run: cargo build --locked", "      - run: cargo test");
  } else if (id === "go") {
    steps.push("      - uses: actions/setup-go@v5\n        with:\n          go-version: stable", "      - run: go build ./...", "      - run: go test ./...");
  } else if (id === "maven" || id === "gradle") {
    steps.push(`      - uses: actions/setup-java@v4\n        with:\n          distribution: temurin\n          java-version: 21\n          cache: ${id}`);
    steps.push(id === "maven" ? "      - run: mvn -B verify" : "      - run: ./gradlew build");
  } else if (id === "dotnet") {
    steps.push("      - uses: actions/setup-dotnet@v4\n        with:\n          dotnet-version: 8.0.x", "      - run: dotnet build", "      - run: dotnet test");
  } else if (id === "flutter") {
    steps.push("      - uses: subosito/flutter-action@v2", "      - run: flutter pub get", "      - run: flutter test");
  } else steps.push("      - run: echo \"Добавьте сюда команды сборки и тестов\"");
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${steps.join("\n")}
`;
}

const EDITORCONFIG = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.{py,rs,java,kt,cs,go}]
indent_size = 4

[*.go]
indent_style = tab

[Makefile]
indent_style = tab

[*.md]
trim_trailing_whitespace = false
`;

function readme(ms: Manager[], name: string): string {
  const id = ms[0]?.id ?? "";
  const run: Record<string, string> = {
    npm: "npm install\nnpm run dev", pnpm: "pnpm install\npnpm dev", yarn: "yarn\nyarn dev", bun: "bun install\nbun dev",
    pip: "python -m venv .venv\n# Windows: .venv\\Scripts\\activate   macOS/Linux: source .venv/bin/activate\npip install -r requirements.txt\npython main.py",
    uv: "uv sync\nuv run main.py", poetry: "poetry install\npoetry run python main.py",
    cargo: "cargo run", go: "go run .", maven: "mvn spring-boot:run   # или mvn package && java -jar target/*.jar", gradle: "./gradlew run",
    dotnet: "dotnet run", flutter: "flutter pub get\nflutter run", dart: "dart run", composer: "composer install\nphp -S localhost:8000",
  };
  return `# ${name}

Коротко: что делает проект и для кого.

## Запуск

\`\`\`bash
${run[id] ?? "# Опишите, как запустить проект"}
\`\`\`

## Возможности

- …
- …

## Технологии

${ms.length ? ms.map((m) => `- ${m.label}`).join("\n") : "- …"}

## Лицензия

MIT
`;
}

function license(author: string): string {
  return `MIT License

Copyright (c) ${new Date().getFullYear()} ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

export function generate(id: GenId, ms: Manager[], name: string, author: string): string {
  switch (id) {
    case "gitignore": return gitignore(ms);
    case "dockerfile": return dockerfile(ms, name);
    case "dockerignore": return dockerignore(ms);
    case "compose": return compose(ms);
    case "ci": return ci(ms);
    case "editorconfig": return EDITORCONFIG;
    case "readme": return readme(ms, name);
    case "license": return license(author);
  }
}
