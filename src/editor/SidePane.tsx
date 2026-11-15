// Правая половина редактора: второй файл, предпросмотр Markdown/HTML, картинки и видео.
import { createEffect, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { monaco, editorOptions } from "./monaco";
import { modelFor, saveFile, tabs, onDidSave } from "./tabs";
import { settings } from "../config/store";
import { core, baseName, parentDir, joinPath } from "../ipc";
import { closeSide, setSide, side, type SideView } from "./side";
import { markdownToHtml } from "./markdown";
const SqliteView = lazy(() => import("./SqliteView"));
const NotebookView = lazy(() => import("../notebook/NotebookView"));
const DbView = lazy(() => import("../databases/DbView"));
const LearnView = lazy(() => import("../learn/LearnView"));
const MapView = lazy(() => import("../projectmap/MapView"));
const VariantsView = lazy(() => import("../variants/VariantsView"));
import WebPreview from "./WebPreview";
const ToolView = lazy(() => import("../tools/ToolView"));

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
};

function toBlobUrl(mime: string, base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** Относительный путь файла рядом с документом → абсолютный. */
function near(docPath: string, rel: string): string | null {
  if (/^[a-z]+:/i.test(rel) || rel.startsWith("//")) return null;
  const clean = rel.split(/[?#]/)[0].replace(/^\.\//, "");
  return joinPath(parentDir(docPath), clean);
}

/** Текст документа: открытая модель (с несохранёнными правками) или файл. */
function useText(path: () => string) {
  const [text, setText] = createSignal("");
  createEffect(
    on(path, (p) => {
      const model = modelFor(p);
      if (model) {
        setText(model.getValue());
        const sub = model.onDidChangeContent(() => setText(model.getValue()));
        onCleanup(() => sub.dispose());
      } else {
        void core.readFile(p).then(setText, () => setText(""));
      }
    }),
  );
  return text;
}

function SideEditor(props: { path: string }) {
  let host!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  onMount(() => {
    editor = monaco.editor.create(host, { ...editorOptions(settings()), model: modelFor(props.path) ?? null, minimap: { enabled: false } });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveFile(props.path));
    onCleanup(() => editor?.dispose());
  });
  createEffect(on(() => props.path, (p) => editor?.setModel(modelFor(p) ?? null), { defer: true }));
  createEffect(() => editor?.updateOptions({ ...editorOptions(settings()), minimap: { enabled: false } }));
  return <div ref={host} class="side-monaco" />;
}

function TextView(props: { text: string; language: string }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const model = monaco.editor.createModel(props.text, props.language);
    const editor = monaco.editor.create(host, { ...editorOptions(settings()), model, readOnly: true, minimap: { enabled: false } });
    onCleanup(() => {
      editor.dispose();
      model.dispose();
    });
  });
  return <div ref={host} class="side-monaco" />;
}

function MarkdownPreview(props: { path: string }) {
  const text = useText(() => props.path);
  let box!: HTMLDivElement;
  const urls: string[] = [];
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)));
  createEffect(() => {
    box.innerHTML = markdownToHtml(text());
    // Картинки рядом с файлом подгружаем через ядро
    for (const img of Array.from(box.querySelectorAll("img"))) {
      const src = img.getAttribute("src") ?? "";
      const abs = near(props.path, src);
      if (!abs) continue;
      img.removeAttribute("src");
      void core.imageRead(abs).then((d) => {
        const u = toBlobUrl(d.mime, d.base64);
        urls.push(u);
        img.src = u;
      }, () => img.replaceWith(document.createTextNode(`[${img.alt || "картинка"}]`)));
    }
    // Ссылки в предпросмотре не открываем внутри Tulpar
    for (const a of Array.from(box.querySelectorAll("a"))) a.addEventListener("click", (e) => e.preventDefault());
  });
  return <div ref={box} class="md-preview" />;
}

/** HTML-страница вживую: свои .css и .js рядом с файлом подставляются внутрь. */
function HtmlPreview(props: { path: string }) {
  const text = useText(() => props.path);
  const [doc, setDoc] = createSignal("");
  const [bump, setBump] = createSignal(0);
  let timer: number | undefined;
  // Сохранили css/js — обновить страницу
  onDidSave(() => setBump(bump() + 1));

  const build = async (html: string) => {
    let out = html;
    const links = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi)];
    for (const m of links) {
      const abs = near(props.path, m[1]);
      if (!abs) continue;
      const css = await core.readFile(abs).catch(() => null);
      // Замена функцией: в CSS/JS бывают «$», которые String.replace иначе портит
      if (css !== null) out = out.replace(m[0], () => `<style>/* ${m[1]} */\n${css}</style>`);
    }
    const scripts = [...html.matchAll(/<script([^>]*)\ssrc=["']([^"']+\.js)["']([^>]*)>\s*<\/script>/gi)];
    for (const m of scripts) {
      const abs = near(props.path, m[2]);
      if (!abs) continue;
      const js = await core.readFile(abs).catch(() => null);
      if (js !== null) out = out.replace(m[0], () => `<script${m[1]}${m[3]}>/* ${m[2]} */\n${js.replace(/<\/script/gi, "<\\/script")}</script>`);
    }
    // Картинки рядом с файлом: в предпросмотре нет адреса страницы, поэтому встраиваем их
    const images = [...out.matchAll(/(<img\b[^>]*?\ssrc=)(["'])([^"']+)\2/gi)];
    for (const m of images) {
      const abs = near(props.path, m[3]);
      if (!abs) continue;
      const img = await core.imageRead(abs).catch(() => null);
      if (img) out = out.replace(m[0], () => `${m[1]}${m[2]}data:${img.mime};base64,${img.base64}${m[2]}`);
    }
    return out;
  };

  createEffect(
    on([text, bump], ([html]) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void build(html).then(setDoc), 350);
    }),
  );
  onCleanup(() => clearTimeout(timer));
  return <iframe class="html-preview" sandbox="allow-scripts allow-forms allow-modals" srcdoc={doc()} title="Предпросмотр HTML" />;
}

function MediaView(props: { path: string }) {
  const [url, setUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [zoom, setZoom] = createSignal(1);
  const [checker, setChecker] = createSignal(true);
  const [size, setSize] = createSignal("");
  const ext = () => props.path.split(".").pop()!.toLowerCase();
  const kind = () => (ext() === "pdf" ? "pdf" : /^(mp4|webm)$/.test(ext()) ? "video" : "image");
  const setSvg = (svg: string) => setUrl(URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
  createEffect(
    on(() => props.path, (p) => {
      setUrl(null);
      setError(null);
      setZoom(1);
      setSize("");
      if (ext() === "svg") {
        // Файл открыт в редакторе — предпросмотр обновляется на каждую правку
        const model = modelFor(p);
        if (model) {
          setSvg(model.getValue());
          let timer = 0;
          const sub = model.onDidChangeContent(() => {
            clearTimeout(timer);
            timer = window.setTimeout(() => setSvg(model.getValue()), 150);
          });
          onCleanup(() => {
            clearTimeout(timer);
            sub.dispose();
          });
        } else void core.readFile(p).then(setSvg, (e) => setError(String(e)));
        return;
      }
      void core.imageRead(p).then((d) => setUrl(toBlobUrl(kind() === "pdf" ? "application/pdf" : MIME[ext()] ?? d.mime, d.base64)), (e) => setError(String(e)));
    }),
  );
  createEffect(on(url, (_u, prev) => prev && URL.revokeObjectURL(prev)));
  return (
    <div class="media-wrap">
      <Show when={kind() === "image" && url()}>
        <div class="media-tools">
          <button class="icon-button" title="Уменьшить" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}>−</button>
          <span class="media-zoom">{Math.round(zoom() * 100)}%</span>
          <button class="icon-button" title="Увеличить" onClick={() => setZoom((z) => Math.min(16, z * 1.25))}>+</button>
          <button class="icon-button" title="Вписать" onClick={() => setZoom(1)}>⤢</button>
          <button class="icon-button" classList={{ on: checker() }} title="Шахматный фон для прозрачности" onClick={() => setChecker(!checker())}>▦</button>
          <span class="media-size" data-no-translate>{size()}</span>
        </div>
      </Show>
      <div class="media-view" classList={{ checker: kind() === "image" && checker(), pdf: kind() === "pdf" }}>
        <Show when={!error()} fallback={<p class="settings-intro">{error()}</p>}>
          <Show when={url()} fallback={<p class="settings-intro">Загружаю…</p>}>
            <Switch>
              <Match when={kind() === "video"}>
                <video src={url()!} controls />
              </Match>
              <Match when={kind() === "pdf"}>
                <iframe class="media-pdf" src={url()!} title={baseName(props.path)} />
              </Match>
              <Match when={kind() === "image"}>
                <img
                  src={url()!}
                  alt={baseName(props.path)}
                  style={zoom() === 1 ? undefined : { "max-width": "none", "max-height": "none", width: `${zoom() * 100}%` }}
                  onLoad={(e) => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
                  onWheel={(e) => {
                    if (!e.ctrlKey) return;
                    e.preventDefault();
                    setZoom((z) => Math.min(16, Math.max(0.1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
                  }}
                />
              </Match>
            </Switch>
          </Show>
        </Show>
      </div>
    </div>
  );
}

const TITLES: Record<SideView["kind"], string> = {
  editor: "",
  markdown: "Предпросмотр · ",
  html: "Страница · ",
  media: "",
  text: "",
  sqlite: "База · ",
  notebook: "Блокнот · ",
  db: "",
  learn: "🎓 ",
  map: "🗺 ",
  variants: "✦ ",
  tool: "",
  web: "Сайт · ",
};

export default function SidePane() {
  const view = () => side()!;
  const others = () => tabs.filter((t) => !t.diffOf && t.path !== view().path);
  return (
    <div class="side-pane" classList={{ wide: ["notebook", "sqlite", "web", "db", "learn", "map", "variants", "tool"].includes(view().kind) }}>
      <div class="side-pane-header">
        <span class="side-pane-title" title={view().path}>
          {TITLES[view().kind]}
          {view().kind === "text" ? (view() as { title: string }).title : ["web", "db", "learn", "map", "variants", "tool"].includes(view().kind) ? view().path : baseName(view().path)}
        </span>
        <Show when={view().kind === "editor" && others().length}>
          <select
            class="side-pane-select"
            title="Показать другой открытый файл"
            onChange={(e) => {
              const path = e.currentTarget.value;
              if (path) setSide({ kind: "editor", path });
              e.currentTarget.value = "";
            }}
          >
            <option value="">Другой файл…</option>
            <For each={others()}>{(t) => <option value={t.path}>{t.title}</option>}</For>
          </select>
        </Show>
        <button class="icon-button" title="Закрыть правую половину" aria-label="Закрыть" onClick={closeSide}>
          ×
        </button>
      </div>
      <div class="side-pane-body">
        <Switch>
          <Match when={view().kind === "editor"}>
            <SideEditor path={view().path} />
          </Match>
          <Match when={view().kind === "markdown"}>
            <MarkdownPreview path={view().path} />
          </Match>
          <Match when={view().kind === "html"}>
            <HtmlPreview path={view().path} />
          </Match>
          <Match when={view().kind === "db" && (view() as Extract<SideView, { kind: "db" }>)}>
            {(v) => <DbView connId={v().connId} schema={v().schema} table={v().table} />}
          </Match>
          <Match when={view().kind === "tool" && (view() as Extract<SideView, { kind: "tool" }>)}>
            {(v) => <ToolView tool={v().tool} />}
          </Match>
          <Match when={view().kind === "variants"}>
            <VariantsView />
          </Match>
          <Match when={view().kind === "map"}>
            <MapView />
          </Match>
          <Match when={view().kind === "learn"}>
            <LearnView />
          </Match>
          <Match when={view().kind === "notebook"}>
            <NotebookView path={view().path} />
          </Match>
          <Match when={view().kind === "sqlite"}>
            <SqliteView path={view().path} />
          </Match>
          <Match when={view().kind === "web" && (view() as Extract<SideView, { kind: "web" }>)}>
            {(v) => <WebPreview url={v().url} />}
          </Match>
          <Match when={view().kind === "media"}>
            <MediaView path={view().path} />
          </Match>
          <Match when={view().kind === "text" && (view() as Extract<SideView, { kind: "text" }>)}>
            {(v) => <TextView text={v().text} language={v().language} />}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
