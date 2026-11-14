// 🔣 Лаборатория регулярок: подсветка совпадений, группы, замена, объяснение.
import { createMemo, createSignal, For, Show } from "solid-js";
import { notify } from "../app/notify";
import { askInput } from "../app/InputBox";
import { askAi, copy, pickJson } from "./ai";
import { PRESETS, allMatches, compile, explain, segments } from "./regex";

const FLAGS: [string, string][] = [["i", "без учёта регистра"], ["m", "^ и $ на каждой строке"], ["s", "точка включает перенос"], ["u", "Юникод"]];

export default function RegexLab() {
  const [pattern, setPattern] = createSignal("(\\w+)@(\\w+)\\.com");
  const [flags, setFlags] = createSignal("gi");
  const [text, setText] = createSignal("Пишите: artur@mail.com или support@tulpar.com\nНе почта: hello@world");
  const [replace, setReplace] = createSignal("$1 [at] $2");
  const [busy, setBusy] = createSignal(false);
  const [aiText, setAiText] = createSignal("");

  const compiled = createMemo(() => compile(pattern(), flags()));
  const matches = createMemo(() => (compiled().re ? allMatches(compiled().re!, text()) : []));
  const replaced = createMemo(() => {
    const re = compiled().re;
    if (!re) return "";
    try {
      return text().replace(new RegExp(re.source, flags()), replace());
    } catch {
      return "";
    }
  });

  const toggle = (f: string) => setFlags(flags().includes(f) ? flags().replace(f, "") : flags() + f);

  const aiMake = async () => {
    const what = await askInput({ title: "ИИ: регулярка по описанию", placeholder: "Например: «номер казахстанского телефона» или «слова с большой буквы»" });
    if (!what?.trim()) return;
    setBusy(true);
    try {
      const answer = await askAi(
        'You write JavaScript regular expressions. Reply ONLY with JSON: {"pattern":"...","flags":"g","sample":"a few lines of sample text with matches and non-matches"}. Pattern without slashes.',
        what,
      );
      const r = answer ? pickJson<{ pattern: string; flags?: string; sample?: string }>(answer) : null;
      if (r?.pattern) {
        setPattern(r.pattern);
        setFlags(r.flags || "g");
        if (r.sample) setText(r.sample);
      } else notify("ИИ не прислал регулярку, попробуйте ещё раз", "error");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const aiExplain = async () => {
    setBusy(true);
    try {
      const answer = await askAi("Explain this regular expression step by step for a beginner. Then list 2 strings that match and 2 that don't. Be brief.", `/${pattern()}/${flags()}`);
      if (answer) setAiText(answer.trim());
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="tool regex">
      <div class="regex-line" data-no-translate>
        <span class="dim">/</span>
        <input class="mono grow" value={pattern()} onInput={(e) => setPattern(e.currentTarget.value)} placeholder="регулярное выражение" spellcheck={false} />
        <span class="dim">/{flags()}</span>
      </div>
      <div class="tool-row">
        <For each={FLAGS}>
          {([f, hint]) => (
            <label class="chk" title={hint}>
              <input type="checkbox" checked={flags().includes(f)} onChange={() => toggle(f)} /> {f} · {hint}
            </label>
          )}
        </For>
      </div>
      <div class="tool-row">
        <select onChange={(e) => { if (e.currentTarget.value) setPattern(e.currentTarget.value); e.currentTarget.value = ""; }}>
          <option value="">Готовые шаблоны…</option>
          <For each={PRESETS}>{([name, p]) => <option value={p}>{name}</option>}</For>
        </select>
        <button disabled={busy()} onClick={() => void aiMake()}>✦ ИИ: сделать по описанию</button>
        <button disabled={busy() || !pattern()} onClick={() => void aiExplain()}>✦ ИИ: объяснить</button>
        <button onClick={() => { copy(`/${pattern()}/${flags()}`); notify("Скопировано"); }}>Копировать</button>
        <span class="grow" />
        <b class={matches().length ? "ok" : "dim"}>{compiled().error ? "" : `Совпадений: ${matches().length}`}</b>
      </div>
      <Show when={compiled().error}>
        <div class="tool-error">Ошибка в выражении: {compiled().error}</div>
      </Show>

      <div class="regex-grid">
        <div>
          <div class="tool-sub">Текст для проверки</div>
          <textarea class="tool-area mono" rows={7} value={text()} onInput={(e) => setText(e.currentTarget.value)} data-no-translate />
          <div class="tool-sub">Подсветка</div>
          <pre class="tool-out mono regex-hl" data-no-translate>
            <For each={segments(text(), matches())}>{(s) => (s.hit < 0 ? s.text : <mark class={"h" + (s.hit % 2)}>{s.text}</mark>)}</For>
          </pre>
          <div class="tool-sub">Замена ($1, $2, $&lt;имя&gt;)</div>
          <input class="mono tool-input" value={replace()} onInput={(e) => setReplace(e.currentTarget.value)} data-no-translate />
          <pre class="tool-out mono" data-no-translate>{replaced()}</pre>
        </div>
        <div>
          <div class="tool-sub">Совпадения и группы</div>
          <div class="regex-matches" data-no-translate>
            <For each={matches().slice(0, 200)}>
              {(m, i) => (
                <div class="regex-match">
                  <b>#{i() + 1}</b> <code>{m.text || "(пусто)"}</code> <span class="dim">@{m.index}</span>
                  <For each={m.groups}>{(g, gi) => <div class="regex-group">${gi() + 1}: <code>{g ?? "—"}</code></div>}</For>
                  <For each={Object.entries(m.named)}>{([k, v]) => <div class="regex-group">{k}: <code>{v ?? "—"}</code></div>}</For>
                </div>
              )}
            </For>
          </div>
          <div class="tool-sub">Что означает</div>
          <div class="regex-explain">
            <For each={explain(pattern())}>
              {(p) => (
                <div>
                  <code data-no-translate>{p.token}</code> — {p.meaning}
                </div>
              )}
            </For>
          </div>
          <Show when={aiText()}>
            <div class="tool-sub">Объяснение ИИ</div>
            <div class="tool-ai" data-no-translate>{aiText()}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}
