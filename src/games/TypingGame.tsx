// ⌨️ Скоростная печать кода: настоящие куски кода, скорость в знаках в минуту.
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { count, unlock } from "../hype/achievements";

const SNIPPETS: Record<string, string[]> = {
  Python: [
    "def greet(name):\n    return f\"Salem, {name}!\"",
    "for i in range(10):\n    if i % 2 == 0:\n        print(i)",
    "nums = [x * x for x in range(5)]\nprint(sum(nums))",
    "with open(\"data.txt\") as f:\n    lines = f.read().splitlines()",
    "class Horse:\n    def __init__(self, name):\n        self.name = name",
  ],
  JavaScript: [
    "const sum = (a, b) => a + b;\nconsole.log(sum(2, 3));",
    "document.querySelector(\"button\").addEventListener(\"click\", () => {\n  alert(\"Сәлем!\");\n});",
    "const users = await fetch(\"/api/users\").then((r) => r.json());",
    "for (const [key, value] of Object.entries(obj)) {\n  console.log(key, value);\n}",
    "export function clamp(x, min, max) {\n  return Math.min(max, Math.max(min, x));\n}",
  ],
  HTML: [
    "<button class=\"btn\" onclick=\"go()\">Начать</button>",
    "<ul>\n  <li>Шымкент</li>\n  <li>Алматы</li>\n</ul>",
    "<img src=\"tulpar.png\" alt=\"Тулпар\" width=\"200\">",
  ],
  Rust: [
    "fn main() {\n    println!(\"Hello, Tulpar!\");\n}",
    "let v: Vec<i32> = (1..=5).map(|x| x * 2).collect();",
  ],
};

const BEST = "tulpar.games.typing.best";

export default function TypingGame() {
  const [lang, setLang] = createSignal("Python");
  const [target, setTarget] = createSignal("");
  const [typed, setTyped] = createSignal("");
  const [start, setStart] = createSignal(0);
  const [end, setEnd] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [errors, setErrors] = createSignal(0);
  const [best, setBest] = createSignal(Number(localStorage.getItem(BEST) ?? 0));
  const timer = setInterval(() => setNow(Date.now()), 200);
  onCleanup(() => clearInterval(timer));
  let input!: HTMLTextAreaElement;

  const pick = () => {
    const list = SNIPPETS[lang()];
    let next = list[Math.floor(Math.random() * list.length)];
    if (next === target() && list.length > 1) next = list[(list.indexOf(next) + 1) % list.length];
    setTarget(next);
    setTyped("");
    setStart(0);
    setEnd(0);
    setErrors(0);
    setTimeout(() => input?.focus(), 30);
  };
  pick();

  const seconds = () => ((end() || now()) - start()) / 1000;
  const cpm = createMemo(() => (start() ? Math.round((typed().length / Math.max(1, seconds())) * 60) : 0));
  const accuracy = () => (typed().length ? Math.max(0, Math.round(((typed().length - errors()) / typed().length) * 100)) : 100);

  const onInput = (v: string) => {
    if (end()) return;
    if (!start()) setStart(Date.now());
    // Автоотступ после Enter: пробелы в начале новой строки пропускаем
    const t = target();
    if (v.length > typed().length && v.endsWith("\n")) {
      const indent = /^[ ]*/.exec(t.slice(v.length))![0];
      v += indent;
    }
    const last = v.length - 1;
    if (v.length > typed().length && v[last] !== t[last]) setErrors((e) => e + 1);
    setTyped(v);
    if (v === t) {
      setEnd(Date.now());
      const score = Math.round((t.length / Math.max(1, (Date.now() - start()) / 1000)) * 60);
      if (score > best()) {
        setBest(score);
        localStorage.setItem(BEST, String(score));
      }
      count("typing", 1, { 10: "typing-10" });
      if (score >= 300) unlock("typing-fast");
    }
  };

  return (
    <div class="tool game-typing">
      <div class="tool-row">
        <select value={lang()} onChange={(e) => { setLang(e.currentTarget.value); pick(); }}>
          <For each={Object.keys(SNIPPETS)}>{(l) => <option value={l}>{l}</option>}</For>
        </select>
        <button onClick={pick}>Другой код ↻</button>
        <span class="grow" />
        <span class="dim">Рекорд: {best()} зн/мин</span>
      </div>
      <div class="typing-stats">
        <div><b>{cpm()}</b><span>знаков/мин</span></div>
        <div><b>{accuracy()}%</b><span>точность</span></div>
        <div><b>{start() ? seconds().toFixed(1) : "0.0"}</b><span>секунд</span></div>
      </div>
      <pre class="typing-target" onClick={() => input.focus()} data-no-translate>
        <For each={[...target()]}>
          {(ch, i) => {
            const state = () => (i() >= typed().length ? (i() === typed().length ? "cur" : "") : typed()[i()] === ch ? "ok" : "bad");
            return <span class={state()}>{ch === "\n" ? "↵\n" : ch}</span>;
          }}
        </For>
      </pre>
      <textarea
        ref={input}
        class="typing-input"
        value={typed()}
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            onInput(typed() + "    ");
          }
        }}
        spellcheck={false}
        autocomplete="off"
      />
      <Show when={end()}>
        <div class="battle-result you">Готово! {cpm()} знаков в минуту, точность {accuracy()}% <button onClick={pick}>Ещё ↻</button></div>
      </Show>
      <div class="dim small">Нажмите на код и печатайте. Отступы после Enter ставятся сами.</div>
    </div>
  );
}
