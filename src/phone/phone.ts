// Телефон как второй экран: запуск сервера в локальной сети, состояние для
// телефона раз в 2 секунды, задачи агенту с телефона.
import { createSignal } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { core, baseName } from "../ipc";
import { root } from "../app/workspace";
import { activePath } from "../editor/tabs";
import { problems, relOf } from "../problems/problems";
import { results } from "../testing/tests";
import { terminalText } from "../terminal/sessions";
import { side } from "../editor/side";
import { messages, send, setAgentMode } from "../ai/chat";
import { executeCommand } from "../commands/registry";
import { notify, notifyError } from "../app/notify";

const [info, setInfo] = createSignal<{ url: string; ip: string } | null>(null);
const [dialog, setDialog] = createSignal(false);
export { info as phoneInfo, dialog as phoneDialog, setDialog as setPhoneDialog };

let timer: number | undefined;
let unlisten: (() => void) | undefined;

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (b) => "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 56]).join("");
}

function snapshot() {
  const list = problems();
  const tests = results();
  const failed = tests.filter((t) => t.status === "failed");
  const web = side();
  let previewPort: number | null = null;
  if (web?.kind === "web") {
    const m = /:(\d{2,5})/.exec((web as { url: string }).url);
    previewPort = m ? Number(m[1]) : null;
  }
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";
  return {
    state: {
      project: root() ? baseName(root()!) : "Tulpar",
      file: activePath() ? relOf(activePath()!) : "",
      errors: list.filter((p) => p.severity === "error").length,
      warnings: list.filter((p) => p.severity === "warning").length,
      problems: list.slice(0, 12).map((p) => `${relOf(p.path)}:${p.line} — ${p.message}`),
      tests: tests.length ? { passed: tests.filter((t) => t.status === "passed").length, failed: failed.length, failedNames: failed.slice(0, 10).map((t) => t.name) } : null,
      terminal: terminalText(40),
      preview: previewPort !== null,
      agent: lastAnswer.slice(-1500),
    },
    previewPort,
  };
}

export async function startPhone() {
  try {
    const r = await core.phoneStart(token());
    setInfo(r);
    setDialog(true);
    const push = () => {
      const s = snapshot();
      void core.phoneSetState(JSON.stringify(s.state), s.previewPort).catch(() => undefined);
    };
    push();
    window.clearInterval(timer);
    timer = window.setInterval(push, 2000);
    unlisten ??= await listen<string>("phone:agent", async (e) => {
      notify(`📱 Задача с телефона: ${e.payload}`);
      setAgentMode(true);
      await executeCommand("workbench.action.chat.open");
      await send(e.payload);
    });
  } catch (e) {
    notifyError("Не удалось включить второй экран", e);
  }
}

export async function stopPhone() {
  window.clearInterval(timer);
  unlisten?.();
  unlisten = undefined;
  await core.phoneStop().catch(() => undefined);
  setInfo(null);
  setDialog(false);
  notify("Второй экран выключен");
}
