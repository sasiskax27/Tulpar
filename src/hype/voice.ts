// 🗣 Код голосом: говорите задачу — ИИ пишет код прямо в место курсора.
// Распознавание речи — встроенное в систему (WebView2/Chromium); ему нужен интернет.
import { createSignal } from "solid-js";
import { editorInstance } from "../editor/instance";
import { monaco } from "../editor/monaco";
import { currentLang } from "../i18n/translate";
import { notify } from "../app/notify";
import { askAi } from "../tools/ai";
import { unlock } from "./achievements";

const [listening, setListening] = createSignal(false);
const [heard, setHeard] = createSignal("");
export { listening, heard };

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

let rec: Recognition | null = null;

export function voiceSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

async function writeCode(request: string) {
  const editor = editorInstance();
  const model = editor?.getModel();
  const pos = editor?.getPosition();
  if (!editor || !model || !pos) {
    notify("Откройте файл — код вставится туда, где курсор");
    return;
  }
  const before = model.getValueInRange(new monaco.Range(Math.max(1, pos.lineNumber - 40), 1, pos.lineNumber, pos.column));
  const after = model.getValueInRange(new monaco.Range(pos.lineNumber, pos.column, Math.min(model.getLineCount(), pos.lineNumber + 15), 1));
  notify(`🗣 «${request}» — ИИ пишет код…`);
  const answer = await askAi(
    `You write code that will be inserted at the cursor. Language: ${model.getLanguageId()}. Reply ONLY with the code to insert, in one fenced block, matching the surrounding indentation and style. The spoken request may contain recognition mistakes — infer the intent.`,
    `Spoken request: ${request}\n\nCode before cursor:\n${before}\n<CURSOR>\n${after}`,
  );
  if (!answer) return;
  const m = /```[^\n]*\n([\s\S]*?)```/.exec(answer);
  const code = (m ? m[1] : answer).replace(/\n$/, "");
  editor.pushUndoStop();
  editor.executeEdits("voice", [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: code, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  unlock("voice");
}

export function toggleVoice(mode: "code" | "chat" = "code") {
  if (listening()) {
    rec?.stop();
    return;
  }
  const w = window as unknown as Record<string, new () => Recognition>;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) {
    notify("Распознавание речи недоступно в этой системе. Обновите Windows и Microsoft Edge WebView2.", "error");
    return;
  }
  rec = new Ctor();
  rec.lang = currentLang() === "en" ? "en-US" : currentLang() === "kk" ? "kk-KZ" : "ru-RU";
  rec.interimResults = true;
  rec.continuous = false;
  let final = "";
  rec.onresult = (e) => {
    let text = "";
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) final = text;
    }
    setHeard(text);
  };
  rec.onerror = (e) => {
    const why: Record<string, string> = {
      "not-allowed": "Нет доступа к микрофону — разрешите его в настройках Windows (Конфиденциальность → Микрофон).",
      network: "Для распознавания речи нужен интернет.",
      "no-speech": "Ничего не услышал — попробуйте ещё раз.",
      "audio-capture": "Микрофон не найден.",
    };
    notify(why[e.error] ?? `Ошибка распознавания: ${e.error}`, "error");
  };
  rec.onend = () => {
    setListening(false);
    const text = final.trim() || heard().trim();
    setHeard("");
    if (!text) return;
    if (mode === "chat") void import("../ai/chat").then((c) => c.send(text));
    else void writeCode(text).catch((err) => notify(String(err), "error"));
  };
  setListening(true);
  setHeard("");
  rec.start();
}
