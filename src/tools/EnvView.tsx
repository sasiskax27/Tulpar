// 🔐 Редактор .env таблицей: секреты скрыты, проверка .gitignore, .env.example.
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { activePath, modelFor, openFile } from "../editor/tabs";
import { core, joinPath, parentDir, baseName } from "../ipc";
import { root } from "../app/workspace";
import { notify } from "../app/notify";
import { monaco } from "../editor/monaco";
import { copy } from "./ai";
import { isEnvFile, looksSecret, parseEnv, toExample, unquote } from "./env";

export default function EnvView() {
  const path = createMemo(() => (isEnvFile(activePath()) ? activePath() : null));
  const [text, setText] = createSignal("");
  const [shown, setShown] = createSignal<Set<string>>(new Set());
  const [newKey, setNewKey] = createSignal("");
  const [newVal, setNewVal] = createSignal("");

  // Следим за моделью файла
  let sub: monaco.IDisposable | undefined;
  const track = () => {
    sub?.dispose();
    const p = path();
    const model = p ? modelFor(p) : undefined;
    setText(model?.getValue() ?? "");
    sub = model?.onDidChangeContent(() => setText(model.getValue()));
  };
  createEffect(track);
  onCleanup(() => sub?.dispose());

  const entries = createMemo(() => parseEnv(text()));
  const duplicates = createMemo(() => {
    const seen = new Map<string, number>();
    for (const e of entries()) seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  });

  const [ignored] = createResource(
    () => [root(), path()] as const,
    async ([r, p]) => {
      if (!r || !p) return true;
      const gi = await core.readFile(joinPath(r, ".gitignore")).catch(() => "");
      const name = baseName(p);
      return gi.split(/\r?\n/).some((l) => {
        const t = l.trim().replace(/^\//, "");
        if (!t || t.startsWith("#")) return false;
        const re = new RegExp("^" + t.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        return re.test(name);
      });
    },
  );

  const edit = (line: number, start: number, end: number, value: string) => {
    const model = path() ? modelFor(path()!) : undefined;
    if (!model) return;
    model.pushEditOperations([], [{ range: new monaco.Range(line, start, line, end), text: value }], () => null);
  };

  const quoteIfNeeded = (v: string) => (/[\s#"']/.test(v) && !/^["'].*["']$/.test(v) ? JSON.stringify(v) : v);

  const add = () => {
    const model = path() ? modelFor(path()!) : undefined;
    const k = newKey().trim().toUpperCase().replace(/[^\w.-]/g, "_");
    if (!model || !k) return;
    const last = model.getLineCount();
    const col = model.getLineMaxColumn(last);
    const prefix = model.getLineContent(last) ? "\n" : "";
    model.pushEditOperations([], [{ range: new monaco.Range(last, col, last, col), text: `${prefix}${k}=${quoteIfNeeded(newVal())}\n` }], () => null);
    setNewKey("");
    setNewVal("");
  };

  const remove = (line: number) => {
    const model = path() ? modelFor(path()!) : undefined;
    if (!model) return;
    const range = line < model.getLineCount() ? new monaco.Range(line, 1, line + 1, 1) : new monaco.Range(line, 1, line, model.getLineMaxColumn(line));
    model.pushEditOperations([], [{ range, text: "" }], () => null);
  };

  const addToGitignore = async () => {
    const r = root();
    if (!r || !path()) return;
    const gi = joinPath(r, ".gitignore");
    const cur = await core.readFile(gi).catch(() => "");
    await core.writeFile(gi, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + "\n# Секреты\n.env\n.env.*\n!.env.example\n");
    notify(".env добавлен в .gitignore — секреты не попадут в git");
  };

  const makeExample = async () => {
    const p = path();
    if (!p) return;
    const target = joinPath(parentDir(p), ".env.example");
    await core.writeFile(target, toExample(text()));
    notify(".env.example создан: ключи без секретных значений, его можно коммитить");
    await openFile(target);
  };

  const toggle = (k: string) => {
    const s = new Set(shown());
    s.has(k) ? s.delete(k) : s.add(k);
    setShown(s);
  };

  return (
    <div class="tool envtool">
      <Show when={path()} fallback={<div class="tool-empty">Откройте файл .env — здесь появится таблица переменных со скрытыми секретами.</div>}>
        <div class="tool-row">
          <b data-no-translate>{baseName(path()!)}</b>
          <span class="dim">переменных: {entries().length}</span>
          <span class="grow" />
          <button onClick={() => void makeExample()}>Сделать .env.example</button>
        </div>
        <Show when={ignored() === false}>
          <div class="tool-error">
            ⚠ Этого файла нет в .gitignore — пароли и ключи могут уйти на GitHub.{" "}
            <button onClick={() => void addToGitignore()}>Добавить в .gitignore</button>
          </div>
        </Show>
        <table class="env-table">
          <tbody>
            <For each={entries()}>
              {(e) => {
                const secret = () => looksSecret(e.key, e.value);
                const visible = () => !secret() || shown().has(e.key + ":" + e.line);
                return (
                  <tr classList={{ dup: duplicates().has(e.key) }}>
                    <td class="env-key" data-no-translate title={duplicates().has(e.key) ? "Ключ повторяется — сработает только последний" : e.comment ?? ""}>
                      {secret() ? "🔒 " : ""}
                      {e.key}
                    </td>
                    <td class="env-val">
                      <input
                        class="mono"
                        type={visible() ? "text" : "password"}
                        value={e.value}
                        onChange={(ev) => edit(e.line, e.start, e.end, ev.currentTarget.value)}
                        data-no-translate
                      />
                    </td>
                    <td class="env-actions">
                      <Show when={secret()}>
                        <button title="Показать / скрыть" onClick={() => toggle(e.key + ":" + e.line)}>{visible() ? "🙈" : "👁"}</button>
                      </Show>
                      <button title="Копировать значение" onClick={() => { copy(unquote(e.value)); notify("Значение скопировано"); }}>⧉</button>
                      <button title="Удалить" onClick={() => remove(e.line)}>×</button>
                    </td>
                  </tr>
                );
              }}
            </For>
            <tr>
              <td><input class="mono" placeholder="НОВЫЙ_КЛЮЧ" value={newKey()} onInput={(e) => setNewKey(e.currentTarget.value)} data-no-translate /></td>
              <td><input class="mono" placeholder="значение" value={newVal()} onInput={(e) => setNewVal(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && add()} data-no-translate /></td>
              <td><button onClick={add} disabled={!newKey().trim()}>+</button></td>
            </tr>
          </tbody>
        </table>
        <div class="dim small">В редакторе секреты размыты, пока курсор не на их строке. Показать все — команда «Показать / скрыть секреты в .env».</div>
      </Show>
    </div>
  );
}
