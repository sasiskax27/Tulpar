// 🩺 Окно Tulpar Doctor.
import { createSignal, For, onMount, Show } from "solid-js";
import { notify } from "../app/notify";
import { diagnose, type Check } from "./doctor";

const ICON = { ok: "✓", warn: "⚠", fail: "✗", info: "ℹ" };

export default function DoctorView() {
  const [checks, setChecks] = createSignal<Check[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [fixing, setFixing] = createSignal<string | null>(null);

  const run = async () => {
    setBusy(true);
    setChecks([]);
    try {
      const list = await diagnose(setChecks);
      const bad = list.filter((c) => c.status === "fail" || c.status === "warn").length;
      void import("../flight/flight").then((f) => f.log("doctor", bad ? `Doctor: найдено проблем — ${bad}` : "Doctor: всё в порядке", !bad));
    } finally {
      setBusy(false);
    }
  };
  onMount(() => void run());

  const fix = async (c: Check) => {
    if (!c.fix) return;
    setFixing(c.id);
    try {
      await c.fix.run();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setFixing(null);
    }
  };

  const fixAll = async () => {
    for (const c of checks()) if ((c.status === "fail" || c.status === "warn") && c.fix && !/Скачать|Настроить|Указать|Создать$/.test(c.fix.label)) await fix(c);
    setTimeout(() => void run(), 1500);
  };

  const problems = () => checks().filter((c) => c.status === "fail" || c.status === "warn");

  return (
    <div class="tool doctor">
      <div class="tool-row">
        <b>{busy() ? "Проверяю проект…" : problems().length ? `Найдено проблем: ${problems().length}` : "Всё в порядке ✨"}</b>
        <span class="grow" />
        <Show when={problems().some((c) => c.fix)}>
          <button class="primary" disabled={busy()} onClick={() => void fixAll()}>Исправить всё</button>
        </Show>
        <button disabled={busy()} onClick={() => void run()}>Проверить снова</button>
      </div>
      <div class="doctor-list">
        <For each={checks()}>
          {(c) => (
            <div class={"doctor-item " + c.status}>
              <span class="doctor-icon">{ICON[c.status]}</span>
              <div class="doctor-body">
                <b>{c.title}</b>
                <span class="dim small" data-no-translate={c.status === "ok" ? "" : undefined}>{c.detail}</span>
              </div>
              <Show when={c.fix && c.status !== "ok"}>
                <button disabled={fixing() === c.id} onClick={() => void fix(c)} data-no-translate={/^[a-z]/.test(c.fix!.label) ? "" : undefined}>
                  {fixing() === c.id ? "…" : c.fix!.label}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
      <div class="dim small">«Исправить всё» запускает установку и правит файлы сам. Скачать программы и настроить ИИ нужно по кнопкам у каждого пункта.</div>
    </div>
  );
}
