// 🧠 Викторина по программированию: 5 вопросов от ИИ на выбранную тему.
import { createSignal, For, Show } from "solid-js";
import { askAi, pickJson } from "../tools/ai";
import { notify } from "../app/notify";
import { unlock } from "../hype/achievements";

interface Q {
  q: string;
  options: string[];
  answer: number;
  why: string;
}

export default function QuizGame() {
  const [topic, setTopic] = createSignal("Python для начинающих");
  const [qs, setQs] = createSignal<Q[]>([]);
  const [i, setI] = createSignal(0);
  const [picked, setPicked] = createSignal<number | null>(null);
  const [right, setRight] = createSignal(0);
  const [busy, setBusy] = createSignal(false);

  const start = async () => {
    setBusy(true);
    try {
      const answer = await askAi(
        `Create a 5-question multiple choice quiz about: ${topic()}. Mix easy and tricky questions, include code questions ("what does this print?"). ` +
          `Reply ONLY with JSON: {"questions":[{"q":"question (code allowed with newlines)","options":["a","b","c","d"],"answer":0,"why":"short explanation"}]}. Use the user's language.`,
        topic(),
      );
      const r = answer ? pickJson<{ questions: Q[] }>(answer) : null;
      if (r?.questions?.length) {
        setQs(r.questions);
        setI(0);
        setRight(0);
        setPicked(null);
      } else notify("ИИ не прислал вопросы — попробуйте ещё раз", "error");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const choose = (k: number) => {
    if (picked() !== null) return;
    setPicked(k);
    if (k === qs()[i()].answer) setRight((r) => r + 1);
  };

  const nextQ = () => {
    if (i() + 1 >= qs().length) {
      if (right() === qs().length) unlock("quiz-perfect");
      setI(qs().length);
      return;
    }
    setI(i() + 1);
    setPicked(null);
  };

  return (
    <div class="tool quiz">
      <div class="tool-row">
        <input class="tool-input grow" value={topic()} onInput={(e) => setTopic(e.currentTarget.value)} placeholder="Тема: JavaScript, SQL, Git, алгоритмы…" />
        <button class="primary" disabled={busy()} onClick={() => void start()}>{busy() ? "Готовлю вопросы…" : "Начать викторину"}</button>
      </div>
      <Show when={qs().length && i() < qs().length}>
        <div class="dim">Вопрос {i() + 1} из {qs().length} · правильно: {right()}</div>
        <pre class="quiz-q" data-no-translate>{qs()[i()].q}</pre>
        <div class="quiz-options">
          <For each={qs()[i()].options}>
            {(o, k) => (
              <button
                classList={{ ok: picked() !== null && k() === qs()[i()].answer, bad: picked() === k() && k() !== qs()[i()].answer }}
                onClick={() => choose(k())}
                data-no-translate
              >
                {o}
              </button>
            )}
          </For>
        </div>
        <Show when={picked() !== null}>
          <div class="tool-ai" data-no-translate>{qs()[i()].why}</div>
          <button class="primary" onClick={nextQ}>{i() + 1 >= qs().length ? "Итог" : "Дальше →"}</button>
        </Show>
      </Show>
      <Show when={qs().length && i() >= qs().length}>
        <div class={"battle-result " + (right() >= 4 ? "you" : "ai")}>
          {right() === qs().length ? "🧠 Идеально!" : right() >= 3 ? "👍 Неплохо!" : "📚 Есть что повторить"} {right()} из {qs().length}
        </div>
      </Show>
    </div>
  );
}
