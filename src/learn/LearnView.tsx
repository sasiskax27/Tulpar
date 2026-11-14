// Учебный режим: уроки слева, задание, редактор и проверка справа.
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { monaco, editorOptions } from "../editor/monaco";
import { settings } from "../config/store";
import { markdownToHtml } from "../editor/markdown";
import { notify } from "../app/notify";
import { COURSES, type Course, type Lesson } from "./courses";
import { aiHint, checkHtml, level, markDone, progress, runPython, saveCode, type CheckResult } from "./learn";

function LessonEditor(props: { lesson: Lesson; language: string; value: string; onChange: (v: string) => void }) {
  let host!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  onMount(() => {
    editor = monaco.editor.create(host, {
      ...editorOptions(settings()),
      value: props.value,
      language: props.language,
      minimap: { enabled: false },
      glyphMargin: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 10 },
    });
    editor.onDidChangeModelContent(() => props.onChange(editor!.getValue()));
    editor.focus();
  });
  onCleanup(() => {
    editor?.getModel()?.dispose();
    editor?.dispose();
  });
  return <div class="learn-editor" ref={host} />;
}

export default function LearnView() {
  const [courseId, setCourseId] = createSignal(COURSES[0].id);
  const course = (): Course => COURSES.find((c) => c.id === courseId())!;
  const firstUnsolved = (c: Course) => c.lessons.find((l) => !progress().done[l.id]) ?? c.lessons[0];
  const [lessonId, setLessonId] = createSignal(firstUnsolved(COURSES[0]).id);
  const lesson = (): Lesson => course().lessons.find((l) => l.id === lessonId()) ?? course().lessons[0];
  const [code, setCode] = createSignal("");
  const [result, setResult] = createSignal<CheckResult | null>(null);
  const [busy, setBusy] = createSignal<"run" | "check" | "hint" | null>(null);
  const [hint, setHint] = createSignal("");
  const [showPreview, setShowPreview] = createSignal(false);
  const [editorKey, setEditorKey] = createSignal(0);

  createEffect(
    on(lessonId, (id) => {
      setCode(progress().code[id] ?? lesson().starter);
      setResult(null);
      setHint("");
      setShowPreview(false);
      setEditorKey((k) => k + 1);
    }),
  );

  const run = async (check: boolean) => {
    setBusy(check ? "check" : "run");
    setHint("");
    try {
      let r: CheckResult;
      if (course().language === "python") r = await runPython(code(), lesson(), check);
      else {
        setShowPreview(true);
        r = check ? checkHtml(code(), lesson()) : { ok: true, output: "" };
      }
      setResult(check || !r.ok ? r : { ...r, ok: false, error: undefined });
      if (check && r.ok) {
        const xp = markDone(lesson().id);
        notify(xp ? `✅ Верно! +${xp} опыта` : "✅ Верно!");
      }
    } catch (e) {
      setResult({ ok: false, output: "", error: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const askHint = async () => {
    setBusy("hint");
    try {
      setHint(await aiHint(course(), lesson(), code(), result()?.error));
    } catch (e) {
      setHint(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const nextLesson = () => {
    const list = course().lessons;
    const i = list.findIndex((l) => l.id === lessonId());
    if (i < list.length - 1) setLessonId(list[i + 1].id);
  };

  const solved = (id: string) => !!progress().done[id];

  return (
    <div class="learn">
      <aside class="learn-nav">
        <div class="learn-stats">
          <span title="Уровень">⭐ {level()}</span>
          <span title="Опыт">{progress().xp} XP</span>
          <span title="Дней подряд">🔥 {progress().streak}</span>
        </div>
        <For each={COURSES}>
          {(c) => (
            <div class="learn-course">
              <button
                class="learn-course-title"
                classList={{ on: c.id === courseId() }}
                onClick={() => {
                  setCourseId(c.id);
                  setLessonId(firstUnsolved(c).id);
                }}
              >
                {c.emoji} {c.title}
                <span class="learn-count">
                  {c.lessons.filter((l) => solved(l.id)).length}/{c.lessons.length}
                </span>
              </button>
              <Show when={c.id === courseId()}>
                <For each={c.lessons}>
                  {(l, i) => (
                    <button class="learn-lesson" classList={{ on: l.id === lessonId(), done: solved(l.id) }} onClick={() => setLessonId(l.id)}>
                      <span class="learn-mark">{solved(l.id) ? "✓" : i() + 1}</span>
                      {l.title}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
      </aside>

      <section class="learn-main">
        <div class="learn-task">
          <h2>{lesson().title}</h2>
          <div class="md-inline" innerHTML={markdownToHtml(lesson().text)} />
        </div>
        <Show when={editorKey()} keyed>
          <LessonEditor
            lesson={lesson()}
            language={course().language}
            value={code()}
            onChange={(v) => {
              setCode(v);
              saveCode(lesson().id, v);
            }}
          />
        </Show>
        <div class="learn-actions">
          <button class="button-quiet" disabled={!!busy()} onClick={() => void run(false)}>
            {busy() === "run" ? "…" : course().language === "html" ? "▶ Показать" : "▶ Запустить"}
          </button>
          <button class="button" disabled={!!busy()} onClick={() => void run(true)}>
            {busy() === "check" ? "Проверяю…" : "✓ Проверить"}
          </button>
          <button class="button-quiet" disabled={!!busy()} onClick={() => void askHint()}>
            {busy() === "hint" ? "Думаю…" : "💡 Подсказка ИИ"}
          </button>
          <button class="button-quiet" title="Вернуть начальный код" onClick={() => (setCode(lesson().starter), saveCode(lesson().id, lesson().starter), setEditorKey((k) => k + 1))}>
            ↺
          </button>
          <Show when={result()?.ok}>
            <button class="button learn-next" onClick={nextLesson}>
              Дальше →
            </button>
          </Show>
        </div>
        <Show when={result()}>
          {(r) => (
            <div class="learn-result" classList={{ ok: r().ok, bad: !!r().error }}>
              <Show when={r().ok}>
                <div class="learn-verdict">✅ Отлично, задание выполнено!</div>
              </Show>
              <Show when={r().error}>
                <pre class="learn-error" data-no-translate>{r().error}</pre>
              </Show>
              <Show when={r().output}>
                <pre class="learn-output" data-no-translate>{r().output}</pre>
              </Show>
            </div>
          )}
        </Show>
        <Show when={hint()}>
          <div class="learn-hint">
            💡 <span innerHTML={markdownToHtml(hint())} />
          </div>
        </Show>
        <Show when={showPreview() && course().language === "html"}>
          <iframe class="learn-preview" sandbox="allow-scripts" srcdoc={code()} title="Ваша страница" />
        </Show>
      </section>
    </div>
  );
}
