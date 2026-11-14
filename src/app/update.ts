// Проверка обновлений на GitHub Releases: при запуске (не чаще раза в 12 часов)
// и по команде «Проверить обновления».
import { core, type UpdateInfo } from "../ipc";
import { settings } from "../config/store";
import { notify, notifyError } from "./notify";

const LAST_KEY = "tulpar.update.lastCheck";
const SKIP_KEY = "tulpar.update.skip";
const INTERVAL = 12 * 60 * 60 * 1000;

async function install(info: UpdateInfo) {
  if (!info.assetUrl || !info.assetName) {
    void core.updateOpenPage(info.page).catch((e) => notifyError("Не удалось открыть страницу", e));
    return;
  }
  notify(`Скачиваю Tulpar ${info.version}… Когда загрузка закончится, откроется установщик, а Tulpar закроется.`);
  try {
    await core.updateInstall(info.assetUrl, info.assetName);
  } catch (e) {
    notifyError("Обновление не удалось", e);
  }
}

function offer(info: UpdateInfo) {
  const actions = [
    { label: info.assetUrl ? "Обновить" : "Скачать", run: () => void install(info) },
    { label: "Что нового", run: () => void core.updateOpenPage(info.page).catch(() => undefined) },
    {
      label: "Пропустить эту версию",
      run: () => {
        try {
          localStorage.setItem(SKIP_KEY, info.version);
        } catch {
          // не запомнится — спросим в следующий раз
        }
      },
    },
  ];
  notify(`Вышла новая версия Tulpar ${info.version} (у вас ${info.current}).`, "info", actions);
}

/** Проверить обновления. manual — по команде: сообщаем и когда обновлений нет. */
export async function checkForUpdates(manual = false) {
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {
    // не страшно
  }
  try {
    const info = await core.updateCheck();
    if (!info) {
      if (manual) notify("У вас последняя версия Tulpar");
      return;
    }
    if (!manual && localStorage.getItem(SKIP_KEY) === info.version) return;
    offer(info);
  } catch (e) {
    if (manual) notifyError("Не удалось проверить обновления", e);
  }
}

/** При запуске: тихо, если включено и давно не проверяли. */
export function scheduleUpdateCheck() {
  window.setTimeout(() => {
    if (settings()["tulpar.update.check"] === false) return;
    const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
    if (Date.now() - last < INTERVAL) return;
    void checkForUpdates(false);
  }, 8000);
}
