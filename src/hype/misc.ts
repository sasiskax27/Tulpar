// 😈 Прожарка кода и ⏪ таймлапс файла.
import { activePath, modelFor } from "../editor/tabs";
import { baseName } from "../ipc";
import { notify } from "../app/notify";
import { executeCommand } from "../commands/registry";
import { unlock } from "./achievements";

export async function roastFile() {
  const path = activePath();
  const model = path ? modelFor(path) : undefined;
  if (!path || !model) {
    notify("Откройте файл, который прожарить 😈");
    return;
  }
  const code = model.getValue().slice(0, 12_000);
  const prompt =
    `Устрой дружескую прожарку моего кода в стиле стендапа: смешно, остроумно, с локальным колоритом (Казахстан, студенческая жизнь), без мата и без оскорблений личности. ` +
    `Каждая шутка должна указывать на реальную проблему в коде. В конце — серьёзный короткий список «что реально исправить». Файл: ${baseName(path)}\n\n\`\`\`${model.getLanguageId()}\n${code}\n\`\`\``;
  await executeCommand("workbench.action.chat.open");
  const { send } = await import("../ai/chat");
  void send(prompt);
  unlock("roasted");
}

export async function timelapse() {
  const path = activePath();
  const model = path ? modelFor(path) : undefined;
  if (!path || !model) {
    notify("Откройте файл — соберу таймлапс из его истории");
    return;
  }
  const { snapshots } = await import("../tools/history");
  const { diff } = await import("../collab/ot");
  const list = (await snapshots(path)).reverse(); // от старых к новым
  const versions = [...list.map((s) => s.content), model.getValue()].filter((v, i, a) => i === 0 || v !== a[i - 1]);
  if (versions.length < 2) {
    notify("Пока мало версий: сохраните файл несколько раз по ходу работы (Ctrl+S) — Машина времени запомнит каждую");
    return;
  }
  const { loadRecording } = await import("../video/recorder");
  const ops = [];
  let t = 0;
  for (let i = 1; i < versions.length; i++) {
    const d = diff(versions[i - 1], versions[i]);
    t += 1000;
    ops.push({ t, path, offset: d.pos, deleteLen: d.del, text: d.ins });
  }
  loadRecording({ started: 0, ended: t + 500, files: { [path]: { initial: versions[0], language: model.getLanguageId() } }, ops });
  const { showVideoStudio } = await import("../video/VideoStudio");
  showVideoStudio();
  notify(`Таймлапс из ${versions.length} версий готов — настройте и сохраните ролик`);
}
