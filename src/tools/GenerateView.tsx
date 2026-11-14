// 🪄 Генератор служебных файлов под стек проекта.
import { createEffect, createResource, createSignal, For, on, Show } from "solid-js";
import { core, joinPath, sepOf, baseName } from "../ipc";
import { root, reloadDir } from "../app/workspace";
import { notify } from "../app/notify";
import { ask } from "../i18n/dialog";
import { openFile } from "../editor/tabs";
import { detectManagers } from "../packages/packages";
import { askAi } from "./ai";
import { GENERATORS, generate, type GenId } from "./generate";

const AUTHOR = "tulpar.generate.author";

export default function GenerateView() {
  const [managers] = createResource(root, async () => detectManagers());
  const [id, setId] = createSignal<GenId>("gitignore");
  const [author, setAuthor] = createSignal(localStorage.getItem(AUTHOR) ?? "");
  const [text, setText] = createSignal("");
  const [exists, setExists] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const gen = () => GENERATORS.find((g) => g.id === id())!;
  const target = () => {
    const r = root();
    return r ? joinPath(r, gen().file.split("/").join(sepOf(r))) : null;
  };

  createEffect(
    on([id, managers, author], () => {
      const r = root();
      setText(generate(id(), managers() ?? [], r ? baseName(r) : "project", author() || "Your Name"));
      const t = target();
      if (t) void core.readFile(t).then(() => setExists(true), () => setExists(false));
    }),
  );

  const write = async (mode: "create" | "merge") => {
    const t = target();
    const r = root();
    if (!t || !r) {
      notify("Откройте папку проекта");
      return;
    }
    let content = text();
    if (exists()) {
      const cur = await core.readFile(t).catch(() => "");
      if (mode === "merge") {
        // Дописываем только строки, которых ещё нет
        const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
        const add = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !have.has(l.trim()));
        if (!add.length) {
          notify("В файле уже всё есть");
          return;
        }
        content = cur + (cur.endsWith("\n") ? "" : "\n") + "\n# Добавлено Tulpar\n" + add.join("\n") + "\n";
      } else if (!(await ask(`Файл ${gen().file} уже есть. Заменить его?`, { kind: "warning" }))) return;
    }
    const written = await core.agentWrite(t, content);
    reloadDir(r);
    setExists(true);
    notify(`Готово: ${gen().file}`);
    await openFile(written);
  };

  const aiTune = async () => {
    const r = root();
    if (!r) return;
    setBusy(true);
    try {
      const files = (await core.listFiles().catch(() => [] as string[])).slice(0, 300);
      const ms = managers() ?? [];
      const manifests: string[] = [];
      for (const m of ms) {
        if (!m.file) continue;
        const c = await core.readFile(joinPath(r, m.file)).catch(() => "");
        if (c) manifests.push(`--- ${m.file}\n${c.slice(0, 3000)}`);
      }
      const answer = await askAi(
        `You adapt a project file (${gen().file}) to a specific project. Reply ONLY with the full final file content in one fenced code block. Keep comments short.`,
        `Draft:\n\`\`\`\n${text()}\n\`\`\`\n\nProject files:\n${files.join("\n")}\n\n${manifests.join("\n\n")}`,
      );
      const m = answer ? /```[^\n]*\n([\s\S]*?)```/.exec(answer) : null;
      if (m) setText(m[1]);
      else if (answer) setText(answer.trim() + "\n");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="tool toolbox">
      <div class="toolbox-list">
        <For each={GENERATORS}>
          {(g) => (
            <button classList={{ on: g.id === id() }} onClick={() => setId(g.id)} title={g.hint}>
              {g.label}
            </button>
          )}
        </For>
      </div>
      <div class="toolbox-work">
        <div class="tool-row">
          <b data-no-translate>{gen().file}</b>
          <span class="dim">— {gen().hint}</span>
        </div>
        <div class="tool-row dim small">
          Проект:{" "}
          <Show when={managers()?.length} fallback={<span>стек не определён — шаблон общий</span>}>
            <span data-no-translate>{managers()!.map((m) => m.label).join(", ")}</span>
          </Show>
        </div>
        <Show when={id() === "license"}>
          <input
            class="tool-input"
            placeholder="Автор (имя или ник)"
            value={author()}
            onInput={(e) => {
              setAuthor(e.currentTarget.value);
              localStorage.setItem(AUTHOR, e.currentTarget.value);
            }}
          />
        </Show>
        <textarea class="tool-area mono" rows={18} value={text()} onInput={(e) => setText(e.currentTarget.value)} data-no-translate />
        <div class="tool-row">
          <button class="primary" onClick={() => void write("create")}>{exists() ? "Заменить файл" : "Создать файл"}</button>
          <Show when={exists() && (id() === "gitignore" || id() === "dockerignore")}>
            <button onClick={() => void write("merge")}>Дописать недостающее</button>
          </Show>
          <button disabled={busy()} onClick={() => void aiTune()}>{busy() ? "ИИ думает…" : "✦ ИИ: подогнать под мой проект"}</button>
          <Show when={exists()}>
            <span class="dim small">файл уже есть</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
