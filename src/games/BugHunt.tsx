// 🐞 Найди баг: ИИ прячет одну ошибку в коде — найдите строку.
import { createSignal, For, Show } from "solid-js";
import { askAi, pickJson } from "../tools/ai";
import { notify } from "../app/notify";
import { count } from "../hype/achievements";

interface Puzzle {
  language: string;
  code: string;
  bugLine: number;
  explanation: string;
}

const SCORE = "tulpar.games.bughunt";

export default function BugHunt() {
  const [lang, setLang] = createSignal("Python");
  const [puzzle, setPuzzle] = createSignal<Puzzle | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [picked, setPicked] = createSignal<number | null>(null);
  const [score, setScore] = createSignal<{ ok: number; all: number }>(JSON.parse(localStorage.getItem(SCORE) ?? '{"ok":0,"all":0}'));

  const next = async () => {
    setBusy(true);
    setPicked(null);
    try {
      const answer = await askAi(
        `You make "find the bug" puzzles. Write a short realistic ${lang()} snippet (8-16 lines) that looks correct but has exactly ONE subtle bug (off-by-one, wrong operator, wrong variable, missing return, etc.). ` +
          `Reply ONLY with JSON: {"language":"${lang()}","code":"...","bugLine":N,"explanation":"why it's a bug and the fix, 1-2 sentences in the user's language"}. bugLine is 1-based. No comments that reveal the bug.`,
        "New puzzle, different from the usual examples.",
      );
      const p = answer ? pickJson<Puzzle>(answer) : null;
      if (p?.code && p.bugLine) setPuzzle(p);
      else notify("ИИ не прислал задачу — попробуйте ещё раз", "error");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const choose = (line: number) => {
    if (picked() !== null || !puzzle()) return;
    setPicked(line);
    const ok = line === puzzle()!.bugLine;
    const s = { ok: score().ok + (ok ? 1 : 0), all: score().all + 1 };
    setScore(s);
    localStorage.setItem(SCORE, JSON.stringify(s));
    if (ok) count("bugs-found", 1, { 5: "bug-detective" });
  };

  return (
    <div class="tool bughunt">
      <div class="tool-row">
        <select value={lang()} onChange={(e) => setLang(e.currentTarget.value)}>
          <For each={["Python", "JavaScript", "TypeScript", "Java", "C++", "Rust", "Go"]}>{(l) => <option>{l}</option>}</For>
        </select>
        <button class="primary" disabled={busy()} onClick={() => void next()}>{busy() ? "ИИ прячет баг…" : puzzle() ? "Следующий" : "Начать"}</button>
        <span class="grow" />
        <span class="dim">Найдено: {score().ok} из {score().all}</span>
      </div>
      <Show when={puzzle()} fallback={<div class="tool-empty">ИИ спрячет в коде одну ошибку. Кликните по строке, где она прячется.</div>}>
        {(p) => (
          <>
            <div class="bug-code" data-no-translate>
              <For each={p().code.split("\n")}>
                {(line, i) => (
                  <button
                    class="bug-line"
                    classList={{ hit: picked() !== null && i() + 1 === p().bugLine, miss: picked() === i() + 1 && i() + 1 !== p().bugLine }}
                    onClick={() => choose(i() + 1)}
                  >
                    <span class="bug-n">{i() + 1}</span>
                    <code>{line || " "}</code>
                  </button>
                )}
              </For>
            </div>
            <Show when={picked() !== null}>
              <div class={"battle-result " + (picked() === p().bugLine ? "you" : "ai")}>
                {picked() === p().bugLine ? "🎯 Точно! " : `Мимо — баг в строке ${p().bugLine}. `}
                <span data-no-translate>{p().explanation}</span>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
