// 📱 Android-студия внутри Tulpar: подготовка, телефоны, создание и запуск приложений.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { notify, notifyError } from "../app/notify";
import { root } from "../app/workspace";
import { ITEMS } from "../store/catalog";
import { install, installed, refreshInstalled, systemHas } from "../store/actions";
import { askAi } from "../tools/ai";
import {
  acceptLicenses, build, buildAndRun, buildRelease, checkSetup, clearLogcat, connectWifi, createEmulator, createProject, createSigningKey,
  devices, findProjects, installSdkPackages, logcat, mirror, openApkFolder, pairWifi, ready, setup, startEmulator,
  type Device, type LogcatLine, type Project,
} from "./android";
import { APP_TEMPLATES, type AppTemplate } from "./templates";

function Step(props: { ok: boolean; title: string; hint: string; action?: () => void; label?: string; busy?: boolean }) {
  return (
    <div class="and-step" classList={{ ok: props.ok }}>
      <span class="and-check">{props.ok ? "✓" : "○"}</span>
      <div class="grow">
        <b>{props.title}</b>
        <div class="dim small">{props.hint}</div>
      </div>
      <Show when={!props.ok && props.action}>
        <button class="primary small" disabled={props.busy} onClick={props.action}>{props.busy ? "Ставлю…" : props.label ?? "Установить"}</button>
      </Show>
    </div>
  );
}

export default function AndroidView() {
  const [phones, setPhones] = createSignal<Device[]>([]);
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [serial, setSerial] = createSignal<string>("");
  const [busy, setBusy] = createSignal<string>("");
  const [tpl, setTpl] = createSignal<AppTemplate>(APP_TEMPLATES[0]);
  const [name, setName] = createSignal("");
  const [idea, setIdea] = createSignal("");
  const [wifiPair, setWifiPair] = createSignal("");
  const [wifiCode, setWifiCode] = createSignal("");
  const [wifiConnect, setWifiConnect] = createSignal("");
  const [showWifi, setShowWifi] = createSignal(false);
  const [logs, setLogs] = createSignal<LogcatLine[] | null>(null);
  const [aiText, setAiText] = createSignal("");

  const refresh = async () => {
    await Promise.all([checkSetup(), refreshInstalled(ITEMS)]);
    setProjects(await findProjects());
    const d = await devices();
    setPhones(d);
    if (!d.some((x) => x.serial === serial())) setSerial(d.find((x) => x.state === "device")?.serial ?? "");
  };
  onMount(() => void refresh());
  const timer = setInterval(() => void devices().then(setPhones), 5000);
  onCleanup(() => clearInterval(timer));

  const item = (id: string) => ITEMS.find((i) => i.id === id)!;
  const has = (id: string) => !!(installed()[id] || systemHas()[id]);
  const put = async (id: string) => {
    setBusy(id);
    await install(item(id));
    setBusy("");
    void refresh();
  };
  const s = () => setup();

  const create = async () => {
    const title = name().trim() || tpl().title;
    setBusy("create");
    try {
      const p = await createProject(tpl(), title);
      if (p && idea().trim() && tpl().id !== "webview") {
        // ИИ-агент дописывает приложение по описанию
        const { send, setAgentMode } = await import("../ai/chat");
        const { executeCommand } = await import("../commands/registry");
        setAgentMode(true);
        void executeCommand("workbench.action.chat.open");
        void send(
          `В папке ${p.name} — новое Android-приложение (Kotlin + Jetpack Compose, файл app/src/main/java/${p.appId.replace(/\./g, "/")}/MainActivity.kt). ` +
            `Переделай его так: ${idea().trim()}. Используй только Compose и Material3, без новых библиотек. Пиши по-русски в интерфейсе.`,
        );
      }
      setName("");
      setIdea("");
      setProjects(await findProjects());
    } catch (e) {
      notifyError("Создание приложения", e);
    } finally {
      setBusy("");
    }
  };

  const pair = async () => {
    try {
      if (wifiPair() && wifiCode()) {
        await pairWifi(wifiPair(), wifiCode());
        notify("Телефон сопряжён ✓ Теперь введите адрес для подключения");
      }
      if (wifiConnect()) {
        await connectWifi(wifiConnect());
        notify("Телефон подключён по Wi-Fi ✓");
        setShowWifi(false);
      }
      setPhones(await devices());
    } catch (e) {
      notifyError("Wi-Fi", e);
    }
  };

  const loadLogs = async () => setLogs(await logcat(serial() || undefined).catch((e) => (notifyError("Журнал телефона", e), [])));
  const explainCrash = async () => {
    const lines = (logs() ?? []).filter((l) => l.level === "error").slice(-40);
    if (!lines.length) return notify("Ошибок в журнале нет 🎉");
    setAiText("…");
    const a = await askAi(
      "You are an Android expert. Explain why this Android app crashed or logs errors, in simple Russian, and give the exact fix in Kotlin/Gradle. Ignore system noise unrelated to the app.",
      lines.map((l) => `${l.time} ${l.level} ${l.tag}: ${l.text}`).join("\n").slice(0, 16000),
    ).catch((e) => String(e));
    setAiText(a ?? "");
  };

  return (
    <div class="android">
      <header class="store-hero">
        <div class="store-hero-icon">📱</div>
        <div class="store-hero-text">
          <b>Android-приложения</b>
          <span class="dim small">Создать приложение, собрать APK и поставить на свой телефон — без Android Studio</span>
        </div>
        <button onClick={() => void refresh()}>⟳ Проверить</button>
      </header>

      <h3 class="store-h">1. Подготовка {ready(s()) ? "— всё готово ✓" : ""}</h3>
      <Show when={s()} fallback={<div class="dim small">Проверяю…</div>}>
        <div class="and-steps">
          <Step ok={s()!.java} title="Java (JDK)" hint="нужна для сборки" action={() => void put("java")} busy={busy() === "java"} />
          <Step ok={s()!.cmdline} title="Android SDK" hint="инструменты Google (~150 МБ)" action={() => void put("android-cmdline")} busy={busy() === "android-cmdline"} />
          <Step ok={s()!.gradle} title="Gradle" hint="сборщик проектов" action={() => void put("gradle")} busy={busy() === "gradle"} />
          <Step
            ok={s()!.platformTools && s()!.platform && s()!.buildTools}
            title="Платформа Android 16 и adb"
            hint="скачается в терминале (~250 МБ), Google попросит принять лицензию — ответьте y"
            label="Скачать"
            action={s()!.cmdline && s()!.java ? () => void installSdkPackages() : undefined}
          />
        </div>
        <Show when={s()!.cmdline && !(s()!.platformTools && s()!.platform && s()!.buildTools)}>
          <div class="dim small">Сборка ругается на лицензии? <button class="link small" onClick={() => void acceptLicenses()}>Принять лицензии Android SDK</button></div>
        </Show>
      </Show>

      <h3 class="store-h">2. Телефон</h3>
      <div class="and-phones">
        <For each={phones()} fallback={
          <div class="dim small">
            Телефон не найден. Включите на телефоне «Для разработчиков» (7 раз нажмите «Номер сборки» в «О телефоне»), затем «Отладка по USB» и подключите кабель.
            Без кабеля — «Отладка по Wi-Fi» ниже. Нет телефона — эмулятор.
          </div>
        }>
          {(d) => (
            <label class="and-phone" classList={{ on: serial() === d.serial, off: d.state !== "device" }}>
              <input type="radio" name="phone" checked={serial() === d.serial} disabled={d.state !== "device"} onChange={() => setSerial(d.serial)} />
              <span>{d.wifi ? "📶" : d.serial.startsWith("emulator") ? "🖥" : "🔌"}</span>
              <b data-no-translate>{d.model}</b>
              <span class="dim small">{d.state === "device" ? "готов" : d.state === "unauthorized" ? "подтвердите «Разрешить отладку» на телефоне" : d.state}</span>
            </label>
          )}
        </For>
      </div>
      <div class="tool-row">
        <button onClick={() => setShowWifi(!showWifi())}>📶 По Wi-Fi</button>
        <Show when={has("scrcpy")} fallback={<button onClick={() => void put("scrcpy")}>📲 Экран телефона (поставить scrcpy)</button>}>
          <button disabled={!serial()} onClick={() => void mirror(serial())}>📲 Экран телефона на ПК</button>
        </Show>
        <Show when={s()?.emulator} fallback={<button disabled={!s()?.cmdline} onClick={() => void createEmulator()}>🖥 Сделать эмулятор</button>}>
          <button onClick={() => void startEmulator()}>🖥 Запустить эмулятор</button>
        </Show>
      </div>
      <Show when={showWifi()}>
        <div class="and-wifi">
          <div class="dim small">На телефоне: «Для разработчиков» → «Отладка по Wi-Fi» → «Подключить с кодом». Телефон и ПК — в одной сети.</div>
          <div class="tool-row">
            <input class="tool-input" placeholder="IP:порт для сопряжения" value={wifiPair()} onInput={(e) => setWifiPair(e.currentTarget.value)} />
            <input class="tool-input" placeholder="код из 6 цифр" value={wifiCode()} onInput={(e) => setWifiCode(e.currentTarget.value)} />
          </div>
          <div class="tool-row">
            <input class="tool-input" placeholder="IP:порт подключения (с главного экрана «Отладка по Wi-Fi»)" value={wifiConnect()} onInput={(e) => setWifiConnect(e.currentTarget.value)} />
            <button class="primary" onClick={() => void pair()}>Подключить</button>
          </div>
        </div>
      </Show>

      <h3 class="store-h">3. Мои приложения</h3>
      <Show when={root()} fallback={<div class="tool-empty">Откройте папку — в ней будут ваши приложения.</div>}>
        <For each={projects()}>
          {(p) => (
            <div class="store-card and-project">
              <div class="store-top">
                <span class="store-icon">🤖</span>
                <div class="store-name"><b data-no-translate>{p.name}</b><span class="dim small" data-no-translate>{p.appId || "Android-проект"}</span></div>
              </div>
              <div class="tool-row">
                <button class="primary" disabled={!ready(s()) || !serial()} title={!serial() ? "Подключите телефон или запустите эмулятор" : ""} onClick={() => void buildAndRun(p, serial())}>▶ Собрать и запустить</button>
                <button disabled={!ready(s())} onClick={() => void build(p)}>🔨 Собрать APK</button>
                <button class="link small" onClick={() => void openApkFolder(p)}>📁 Где APK</button>
                <button class="link small" onClick={() => void loadLogs()}>📜 Журнал телефона</button>
                <span class="grow" />
                <button class="link small" onClick={() => void createSigningKey(p)}>🔑 Ключ подписи</button>
                <button class="link small" disabled={!ready(s())} onClick={() => void buildRelease(p)}>🏪 Для Google Play (.aab)</button>
              </div>
            </div>
          )}
        </For>

        <Show when={logs()}>
          <div class="tool-row">
            <b class="small">Журнал телефона: ошибки и предупреждения</b>
            <span class="grow" />
            <button class="small" onClick={() => void loadLogs()}>⟳</button>
            <button class="small" onClick={() => void clearLogcat(serial() || undefined).then(loadLogs)}>Очистить</button>
            <button class="primary small" onClick={() => void explainCrash()}>✨ Почему падает?</button>
            <button class="link small" onClick={() => { setLogs(null); setAiText(""); }}>Скрыть</button>
          </div>
          <Show when={aiText()}><div class="tool-ai">{aiText()}</div></Show>
          <div class="log-list" data-no-translate>
            <For each={logs()!.slice(-300)} fallback={<div class="dim small">Пусто — ошибок нет</div>}>
              {(l) => (
                <div class={`log-line ${l.level}`}>
                  <span class="log-time">{l.time}</span>
                  <span class="log-src">{l.tag}</span>
                  <span class="log-text">{l.text}</span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="tool-sub">＋ Новое приложение</div>
        <div class="ai-service-grid compact">
          <For each={APP_TEMPLATES}>
            {(t) => (
              <button class="ai-service" classList={{ on: tpl().id === t.id }} onClick={() => setTpl(t)}>
                <span class="ai-service-icon">{t.icon}</span>
                <span class="ai-service-name">{t.title}</span>
                <span class="dim small">{t.desc}</span>
              </button>
            )}
          </For>
        </div>
        <div class="tool-row">
          <input class="tool-input" placeholder="Название приложения" value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          <Show when={tpl().id !== "webview"}>
            <input class="tool-input grow" placeholder="✨ Что должно уметь (ИИ допишет), например: калькулятор калорий" value={idea()} onInput={(e) => setIdea(e.currentTarget.value)} />
          </Show>
          <button class="primary" disabled={busy() === "create"} onClick={() => void create()}>{busy() === "create" ? "Создаю…" : "Создать"}</button>
        </div>
        <Show when={tpl().id === "webview"}>
          <div class="dim small">Возьмёт index.html, CSS и JS из корня открытой папки. Нет своих — положит страницу-пример.</div>
        </Show>
      </Show>
    </div>
  );
}
