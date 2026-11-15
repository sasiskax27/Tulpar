// 🛡 Центр безопасности: уязвимые пакеты, забытые ключи в коде, защита .env.
import { createSignal, For, onMount, Show } from "solid-js";
import { notify } from "../app/notify";
import { core, joinPath } from "../ipc";
import { root } from "../app/workspace";
import { runInTerminal } from "../terminal/sessions";
import { scanDependencies, updateCommand, type Vuln } from "./osv";

interface Secret { file: string; line: number; message: string }

const SEV = { critical: "Критическая", high: "Высокая", medium: "Средняя", low: "Низкая", unknown: "Неизвестна" };

export default function SecurityView() {
  const [vulns, setVulns] = createSignal<Vuln[] | null>(null);
  const [checked, setChecked] = createSignal(0);
  const [secrets, setSecrets] = createSignal<Secret[] | null>(null);
  const [envOk, setEnvOk] = createSignal<boolean | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const score = () => {
    let s = 100;
    for (const v of vulns() ?? []) s -= v.severity === "critical" ? 25 : v.severity === "high" ? 15 : v.severity === "medium" ? 6 : 2;
    s -= (secrets()?.length ?? 0) * 15;
    if (envOk() === false) s -= 20;
    return Math.max(0, s);
  };

  const scanSecrets = async () => {
    const r = root();
    if (!r) return [];
    const { localChecks } = await import("../git/review");
    const files = (await core.listFiles()).filter((f) => /\.(ts|tsx|js|jsx|mjs|py|rs|go|java|kt|cs|php|rb|json|ya?ml|toml|ini|cfg|sh|ps1|swift|dart)$/i.test(f) && !/(^|\/)(node_modules|dist|build|target|\.venv|venv|vendor)\//.test(f) && !/(\.lock|lock\.json)$/.test(f));
    const out: Secret[] = [];
    for (const rel of files.slice(0, 1500)) {
      const text = await core.readFile(joinPath(r, rel)).catch(() => "");
      if (!text || text.length > 300_000) continue;
      const diff = `+++ b/${rel}\n@@ -0,0 +1 @@\n` + text.split("\n").map((l) => "+" + l).join("\n");
      for (const f of localChecks(diff)) if (/ключ|пароль|токен|key|secret/i.test(f.message)) out.push({ file: f.file, line: f.line, message: f.message });
    }
    return out;
  };

  const checkEnv = async () => {
    const r = root();
    if (!r) return null;
    const hasEnv = await core.readFile(joinPath(r, ".env")).then(() => true, () => false);
    if (!hasEnv) return true;
    const gi = await core.readFile(joinPath(r, ".gitignore")).catch(() => "");
    return /^\s*\/?\.env(\*|\b)/m.test(gi);
  };

  const scan = async () => {
    if (!root()) {
      notify("Откройте папку проекта");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [dep, sec, env] = await Promise.all([
        scanDependencies().catch((e) => {
          setError(`Проверка пакетов: ${e}`);
          return { vulns: [] as Vuln[], checked: 0 };
        }),
        scanSecrets(),
        checkEnv(),
      ]);
      setVulns(dep.vulns);
      setChecked(dep.checked);
      setSecrets(sec);
      setEnvOk(env);
      void import("../flight/flight").then((f) => f.log("security", `Безопасность: ${score()}/100, уязвимостей ${dep.vulns.length}, ключей в коде ${sec.length}`, score() >= 80));
    } finally {
      setBusy(false);
    }
  };
  onMount(() => void scan());

  const explain = async (v: Vuln) => {
    await import("../commands/registry").then((m) => m.executeCommand("workbench.action.chat.open"));
    const { send } = await import("../ai/chat");
    void send(`Объясни простыми словами уязвимость ${v.id} в пакете ${v.pkg} ${v.version} (${v.ecosystem}): ${v.summary}. Насколько это опасно для моего проекта и как исправить? Подробности: ${v.url}`);
  };

  const openSecret = async (s: Secret) => {
    const r = root();
    if (!r) return;
    const { openFile } = await import("../editor/tabs");
    const { monaco } = await import("../editor/monaco");
    await openFile(joinPath(r, s.file), new monaco.Range(s.line, 1, s.line, 1));
  };

  return (
    <div class="tool security">
      <div class="tool-row">
        <Show when={vulns()} fallback={<b>{busy() ? "Проверяю…" : ""}</b>}>
          <div class="security-score" classList={{ ok: score() >= 80, err: score() < 50 }}>
            <b>{score()}</b>
            <span>/100</span>
          </div>
        </Show>
        <span class="dim small">{checked() ? `Проверено пакетов: ${checked()} по базе OSV.dev` : ""}</span>
        <span class="grow" />
        <button disabled={busy()} onClick={() => void scan()}>{busy() ? "Проверяю…" : "Проверить снова"}</button>
      </div>
      <Show when={error()}><div class="tool-error">{error()}</div></Show>

      <Show when={envOk() === false}>
        <div class="security-card critical">
          <b>⚠ .env не скрыт от git</b>
          <span>Пароли и ключи могут попасть на GitHub.</span>
          <button onClick={() => void import("../editor/side").then((m) => m.showTool("env"))}>Исправить</button>
        </div>
      </Show>

      <div class="tool-sub">Уязвимые пакеты</div>
      <Show when={vulns()?.length} fallback={<div class="dim small">{vulns() ? "Известных уязвимостей не найдено ✓" : ""}</div>}>
        <For each={vulns()}>
          {(v) => (
            <div class={"security-card " + v.severity}>
              <div class="tool-row">
                <b data-no-translate>{v.pkg} {v.version}</b>
                <span class={"sev " + v.severity}>{SEV[v.severity]}</span>
                <a class="dim small" href={v.url} onClick={(e) => { e.preventDefault(); void core.openUrl(v.url); }} data-no-translate>{v.id}</a>
              </div>
              <span class="small" data-no-translate>{v.summary}</span>
              <span class="dim small">{v.fixed ? `Исправлено в версии ${v.fixed}` : "Исправленной версии пока нет"}</span>
              <div class="tool-row">
                <Show when={updateCommand(v)}>
                  <button class="primary" onClick={() => void runInTerminal(updateCommand(v)!, "Обновление")}>Обновить</button>
                </Show>
                <button onClick={() => void explain(v)}>✦ Объяснить</button>
              </div>
            </div>
          )}
        </For>
      </Show>

      <div class="tool-sub">Ключи и пароли в коде</div>
      <Show when={secrets()?.length} fallback={<div class="dim small">{secrets() ? "Забытых ключей не найдено ✓" : ""}</div>}>
        <For each={secrets()}>
          {(s) => (
            <button class="recall-hit" onClick={() => void openSecret(s)}>
              <b data-no-translate>{s.file}:{s.line}</b>
              <span class="small">{s.message}</span>
            </button>
          )}
        </For>
        <div class="dim small">Перенесите ключи в .env, а сами ключи на сервисе лучше перевыпустить — они уже могли утечь.</div>
      </Show>
      <div class="dim small">В OSV.dev уходят только названия и версии пакетов — ваш код никуда не отправляется.</div>
    </div>
  );
}
