// 🖥 VM Studio: виртуальные машины на QEMU в пару кликов.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { core } from "../ipc";
import { open, ask } from "../i18n/dialog";
import { notify } from "../app/notify";
import { copy } from "../tools/ai";
import { createVm, forgetVm, installQemu, refreshStatus, snapshot, snapshots, startVm, status, stopVm, TEMPLATES, updateVm, vms, type Snapshot, type Template, type Vm } from "./vms";

const ACCEL: Record<string, string> = { kvm: "KVM — быстро", whpx: "Windows Hypervisor (WHPX)", hvf: "Hypervisor.framework — быстро", tcg: "без ускорения — медленно" };

function CreateForm(props: { onDone: () => void }) {
  const [t, setT] = createSignal<Template>(TEMPLATES[0]);
  const [name, setName] = createSignal("");
  const [iso, setIso] = createSignal("");
  const [ram, setRam] = createSignal(TEMPLATES[0].ramMb);
  const [cpus, setCpus] = createSignal(TEMPLATES[0].cpus);
  const [disk, setDisk] = createSignal(TEMPLATES[0].diskGb);
  const [busy, setBusy] = createSignal(false);
  const choose = (x: Template) => {
    setT(x);
    setRam(x.ramMb);
    setCpus(x.cpus);
    setDisk(x.diskGb);
  };
  const pickIso = async () => {
    const p = await open({ title: "ISO-образ системы", filters: [{ name: "ISO", extensions: ["iso", "img"] }] });
    if (typeof p === "string") setIso(p);
  };
  const create = async () => {
    setBusy(true);
    const vm = await createVm(t(), name().trim() || t().name, iso(), ram(), cpus(), disk());
    setBusy(false);
    if (vm) props.onDone();
  };
  return (
    <div class="vm-create">
      <div class="tool-sub">1. Какая система</div>
      <div class="ai-service-grid compact">
        <For each={TEMPLATES}>
          {(x) => (
            <button class="ai-service" classList={{ on: t().id === x.id }} onClick={() => choose(x)}>
              <span class="ai-service-icon">{x.icon}</span>
              <span class="ai-service-name">{x.name}</span>
              <span class="dim small">{x.note}</span>
            </button>
          )}
        </For>
      </div>
      <div class="tool-sub">2. Образ установки (ISO)</div>
      <div class="tool-row">
        <button onClick={() => void pickIso()}>📀 Выбрать ISO…</button>
        <Show when={t().isoPage}><button class="link" onClick={() => void core.openUrl(t().isoPage)}>Скачать {t().name} с официального сайта</button></Show>
      </div>
      <Show when={iso()}><div class="dim small" data-no-translate>{iso()}</div></Show>
      <div class="tool-sub">3. Параметры</div>
      <div class="vm-params">
        <label>Имя<input class="tool-input" placeholder={t().name} value={name()} onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label>Память, МБ<input class="tool-input" type="number" min="256" step="256" value={ram()} onInput={(e) => setRam(Number(e.currentTarget.value) || 1024)} /></label>
        <label>Ядра<input class="tool-input" type="number" min="1" max="64" value={cpus()} onInput={(e) => setCpus(Number(e.currentTarget.value) || 1)} /></label>
        <label>Диск, ГБ<input class="tool-input" type="number" min="1" value={disk()} onInput={(e) => setDisk(Number(e.currentTarget.value) || 10)} /></label>
      </div>
      <div class="tool-row">
        <button class="primary" disabled={busy()} onClick={() => void create()}>{busy() ? "Создаю диск…" : "✨ Создать машину"}</button>
        <button onClick={props.onDone}>Отмена</button>
      </div>
    </div>
  );
}

function VmCard(props: { vm: Vm }) {
  const vm = () => props.vm;
  const on = () => status()[vm().id] === "running";
  const [snaps, setSnaps] = createSignal<Snapshot[] | null>(null);
  const loadSnaps = async () => setSnaps(await snapshots(vm()).catch(() => []));
  const takeSnap = async () => {
    const name = `snap-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    if (await snapshot(vm(), "-c", name)) {
      notify(`Снимок ${name} сохранён`);
      void loadSnaps();
    }
  };
  const restore = async (s: Snapshot) => {
    if (!(await ask(`Вернуть машину к снимку «${s.name}»? Всё, что сделано после него, пропадёт.`, { title: "Откат", kind: "warning" }))) return;
    if (await snapshot(vm(), "-a", s.name)) notify("Машина возвращена к снимку");
  };
  const del = async (s: Snapshot) => {
    if (await snapshot(vm(), "-d", s.name)) void loadSnaps();
  };
  const ejectIso = () => updateVm(vm().id, { iso: "" });
  const t = () => TEMPLATES.find((x) => x.id === vm().template);
  return (
    <div class="store-card" classList={{ on: on() }}>
      <div class="store-top">
        <span class="store-icon">{t()?.icon ?? "💻"}</span>
        <div class="store-name">
          <b data-no-translate>{vm().name}</b>
          <span class="dim small">{vm().ramMb} МБ · {vm().cpus} ядр. · {vm().diskGb} ГБ{vm().iso ? " · ISO вставлен" : ""}</span>
        </div>
        <Show when={on()}><span class="store-live">● работает</span></Show>
      </div>
      <div class="tool-row">
        <Show when={on()} fallback={<button class="primary" onClick={() => void startVm(vm())}>▶ Запустить</button>}>
          <button onClick={() => void stopVm(vm())}>■ Выключить</button>
        </Show>
        <button title={`ssh -p ${vm().sshPort} user@localhost`} onClick={() => { copy(`ssh -p ${vm().sshPort} user@localhost`); notify("Команда SSH скопирована: замените user на своё имя в машине"); }}>SSH</button>
        <button disabled={on()} onClick={() => void takeSnap()}>📸 Снимок</button>
        <button onClick={() => void (snaps() ? setSnaps(null) : loadSnaps())}>Снимки</button>
        <Show when={vm().iso && !on()}><button class="link small" onClick={ejectIso} title="После установки ОС — грузиться с диска">Извлечь ISO</button></Show>
        <span class="grow" />
        <button class="link small danger" disabled={on()} onClick={async () => { if (await ask(`Убрать «${vm().name}» из списка? Файл диска останется в папке машин.`, { title: "Убрать машину" })) forgetVm(vm().id); }}>Убрать</button>
      </div>
      <Show when={snaps()}>
        <Show when={snaps()!.length} fallback={<div class="dim small">Снимков пока нет. Снимок — точка, к которой можно вернуться одним нажатием.</div>}>
          <For each={snaps()!}>
            {(s) => (
              <div class="tool-row small">
                <span data-no-translate>📸 {s.name}</span>
                <span class="dim">{s.date}</span>
                <span class="grow" />
                <button class="link small" disabled={on()} onClick={() => void restore(s)}>Вернуть</button>
                <button class="link small danger" disabled={on()} onClick={() => void del(s)}>Удалить</button>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

export default function VmView() {
  const [info, setInfo] = createSignal<{ qemu: boolean; version: string; dir: string; accel: string } | null>(null);
  const [creating, setCreating] = createSignal(false);
  const check = async () => setInfo(await core.vmInfo().catch(() => null));
  onMount(() => {
    void check();
    void refreshStatus();
  });
  const timer = setInterval(() => void refreshStatus(), 3000);
  onCleanup(() => clearInterval(timer));

  return (
    <div class="tool vm">
      <header class="store-hero">
        <div class="store-hero-icon">🖥</div>
        <div class="store-hero-text">
          <b>VM Studio</b>
          <span class="dim small">Виртуальные машины прямо из Tulpar: Linux, Windows и другие — для тестов, серверов и лабораторных.</span>
        </div>
        <Show when={info()?.qemu}>
          <span class="store-hero-stat" data-no-translate>{info()!.version.replace(/^qemu-img version /i, "QEMU ")}</span>
          <span class="store-hero-stat">{ACCEL[info()!.accel] ?? info()!.accel}</span>
        </Show>
      </header>
      <Show when={info()} fallback={<div class="dim small">Проверяю QEMU…</div>}>
        <Show when={info()!.qemu} fallback={
          <div class="tool-empty">
            Для виртуальных машин нужен QEMU — бесплатный и открытый.<br />
            <button class="primary" onClick={() => void installQemu()}>Установить QEMU</button> <button onClick={() => void check()}>Проверить снова</button>
          </div>
        }>
          <Show when={!creating()} fallback={<CreateForm onDone={() => setCreating(false)} />}>
            <div class="tool-row">
              <button class="primary" onClick={() => setCreating(true)}>＋ Новая машина</button>
              <span class="grow" />
              <span class="dim small" data-no-translate title="Папка дисков">📁 {info()!.dir}</span>
            </div>
            <Show when={vms().length} fallback={<div class="tool-empty">Машин пока нет. Нажмите «Новая машина», выберите систему и ISO — остальное Tulpar настроит сам.</div>}>
              <div class="store-grid wide">
                <For each={vms()}>{(v) => <VmCard vm={v} />}</For>
              </div>
            </Show>
            <div class="dim small">Экран машины откроется отдельным окном QEMU. Интернет в машине работает сразу, а порт SSH машины проброшен на этот компьютер (кнопка «SSH»).</div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
