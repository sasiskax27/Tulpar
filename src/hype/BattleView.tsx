// ⚔️ Битва с ИИ.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { monaco, editorOptions } from "../editor/monaco";
import { settings } from "../config/store";
import { notify } from "../app/notify";
import { aiSolve, loadScore, makeTask, runTests, saveScore, type BattleLang, type BattleTask, type Level, type TestResult } from "./battle";
import { count, unlock } from "./achievements";

/** Сколько «печатает» ИИ: символов в секунду и время на подумать. */
const AI_CPS = { easy: 9, medium: 7, hard: 5 };
const AI_THINK = { easy: 8, medium: 15, hard: 25 };

export default function BattleView() {
  const [lang, setLang] = createSignal<BattleLang>("python");
  const [level, setLevel] = createSignal<Level>("easy");
  const [topic, setTopic] = createSignal("");
  const [phase, setPhase] = createSignal<"idle" | "loading" | "fight" | "done">("idle");
  const [task, setTask] = createSignal<BattleTask | null>(null);
  const [elapsed, setElapsed] = createSignal(0);
  const [aiProgress, setAiProgress] = createSignal(0);
  const [aiCode, setAiCode] = createSignal("");
  const [yourResult, setYourResult] = createSignal<TestResult | null>(null);
  const [winner, setWinner] = createSignal<"you" | "ai" | "draw" | null>(null);
  const [score, setScore] = createSignal(loadScore());
  const [checking, setChecking] = createSignal(false);
  let host!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let timer = 0;
  let aiFinishAt = Infinity;
  let aiPasses = false;
  let started = 0;

  onMount(() => {
    editor = monaco.editor.create(host, { ...editorOptions(settings()), model: monaco.editor.createModel("", "python"), automaticLayout: true, minimap: { enabled: false } });
  });
  onCleanup(() => {
    clearInterval(timer);
    editor?.getModel()?.dispose();
    editor?.dispose();
  });

  const finish = (w: "you" | "ai" | "draw") => {
    clearInterval(timer);
    setWinner(w);
    setPhase("done");
    const s = { ...score() };
    if (w === "you") s.you++;
    if (w === "ai") s.ai++;
    setScore(s);
    saveScore(s);
    count("battles", 1, { 5: "battle-5" });
    if (w === "you") unlock("battle-win");
  };

  const start = async () => {
    setPhase("loading");
    setWinner(null);
    setYourResult(null);
    setAiCode("");
    setAiProgress(0);
    try {
      const t = await makeTask(lang(), level(), topic().trim());
      if (!t) {
        notify("ИИ не придумал задачу — проверьте, что ИИ настроен, и попробуйте ещё раз", "error");
        setPhase("idle");
        return;
      }
      setTask(t);
      const model = editor!.getModel()!;
      monaco.editor.setModelLanguage(model, lang());
      model.setValue(t.starter || "");
      editor!.focus();
      setPhase("fight");
      started = Date.now();
      aiFinishAt = Infinity;
      // ИИ решает параллельно; его «время» — подумать + напечатать
      void aiSolve(t, lang()).then(async (code) => {
        setAiCode(code);
        aiPasses = (await runTests(code, t, lang())).passed === t.tests.length;
        aiFinishAt = started + (AI_THINK[level()] + code.length / AI_CPS[level()]) * 1000;
      });
      timer = window.setInterval(() => {
        const now = Date.now();
        setElapsed(Math.floor((now - started) / 1000));
        if (aiFinishAt !== Infinity) {
          const total = aiFinishAt - started;
          setAiProgress(Math.min(1, (now - started) / total));
          if (now >= aiFinishAt && phase() === "fight") {
            if (aiPasses) finish("ai");
            else {
              aiFinishAt = Infinity; // ИИ ошибся — у вас есть время
              setAiProgress(1);
              notify("ИИ сдал решение с ошибкой 😅 У вас ещё есть шанс!");
            }
          }
        }
      }, 200);
    } catch (e) {
      notify(String(e), "error");
      setPhase("idle");
    }
  };

  const check = async () => {
    const t = task();
    if (!t || !editor) return;
    setChecking(true);
    try {
      const r = await runTests(editor.getValue(), t, lang());
      setYourResult(r);
      if (r.passed === r.total && phase() === "fight") finish("you");
    } finally {
      setChecking(false);
    }
  };

  const giveUp = () => finish("ai");

  return (
    <div class="tool battle">
      <div class="battle-score">
        <div><b>{score().you}</b><span>Вы</span></div>
        <div class="battle-vs">VS</div>
        <div><b>{score().ai}</b><span>ИИ</span></div>
      </div>
      <Show when={phase() === "idle" || phase() === "done"}>
        <div class="tool-row">
          <select value={lang()} onChange={(e) => setLang(e.currentTarget.value as BattleLang)}>
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
          </select>
          <select value={level()} onChange={(e) => setLevel(e.currentTarget.value as Level)}>
            <option value="easy">Легко</option>
            <option value="medium">Средне</option>
            <option value="hard">Сложно</option>
          </select>
          <input class="tool-input grow" placeholder="Тема (необязательно): строки, массивы, математика…" value={topic()} onInput={(e) => setTopic(e.currentTarget.value)} />
          <button class="primary" onClick={() => void start()}>{phase() === "done" ? "Реванш ⚔️" : "В бой ⚔️"}</button>
        </div>
      </Show>
      <Show when={phase() === "loading"}>
        <div class="tool-empty">ИИ придумывает задачу…</div>
      </Show>
      <Show when={winner()}>
        <div class={"battle-result " + winner()}>
          {winner() === "you" ? `🏆 Вы победили за ${elapsed()} с!` : winner() === "ai" ? "🤖 ИИ оказался быстрее. Реванш?" : "🤝 Ничья"}
        </div>
      </Show>
      <Show when={task() && phase() !== "loading"}>
        <div class="battle-task">
          <b data-no-translate>{task()!.title}</b>
          <div data-no-translate>{task()!.description}</div>
        </div>
        <Show when={phase() === "fight"}>
          <div class="battle-race">
            <span>⏱ {elapsed()} с</span>
            <div class="battle-bar"><div class="fill" style={{ width: `${aiProgress() * 100}%` }} /></div>
            <span>🤖 {aiFinishAt === Infinity && !aiCode() ? "думает…" : `${Math.round(aiProgress() * 100)}%`}</span>
          </div>
        </Show>
      </Show>
      <div class="battle-editor" ref={host} style={{ display: task() && phase() !== "loading" ? undefined : "none" }} />
      <Show when={phase() === "fight"}>
        <div class="tool-row">
          <button class="primary" disabled={checking()} onClick={() => void check()}>{checking() ? "Проверяю…" : "Проверить ▶"}</button>
          <button onClick={giveUp}>Сдаться</button>
        </div>
      </Show>
      <Show when={yourResult()}>
        {(r) => (
          <div class="battle-tests">
            <b classList={{ ok: r().passed === r().total }}>Тесты: {r().passed}/{r().total}</b>
            <Show when={r().error}><pre class="tool-error">{r().error}</pre></Show>
            <For each={r().details}>{(d) => <div class="mono small" data-no-translate>{d}</div>}</For>
          </div>
        )}
      </Show>
      <Show when={phase() === "done" && aiCode()}>
        <details class="battle-ai">
          <summary>Решение ИИ</summary>
          <pre class="tool-out mono" data-no-translate>{aiCode()}</pre>
        </details>
      </Show>
    </div>
  );
}
