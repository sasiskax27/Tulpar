// 🌐 HTTP-клиент: как Postman, только внутри редактора и без аккаунта.
import { createSignal, For, Show } from "solid-js";
import { core, type HttpResponse } from "../ipc";
import { notify } from "../app/notify";
import { askInput } from "../app/InputBox";
import { askAi, copy, pickJson } from "./ai";
import {
  METHODS, applyVars, formatSize, fromCurl, parseHeaders, parseVars, prettyBody, toCurl, toFetch, toPython,
  type HttpDraft, type HttpHistoryItem,
} from "./http";

const HIST = "tulpar.http.history";
const VARS = "tulpar.http.vars";

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

export default function HttpClient() {
  const [method, setMethod] = createSignal("GET");
  const [url, setUrl] = createSignal("https://jsonplaceholder.typicode.com/todos/1");
  const [headers, setHeaders] = createSignal("Accept: application/json");
  const [body, setBody] = createSignal("");
  const [vars, setVars] = createSignal<string>(load(VARS, "# Переменные: {{base}} в адресе\nbase = http://localhost:3000"));
  const [tab, setTab] = createSignal<"headers" | "body" | "vars">("headers");
  const [resTab, setResTab] = createSignal<"body" | "headers">("body");
  const [busy, setBusy] = createSignal(false);
  const [res, setRes] = createSignal<HttpResponse | null>(null);
  const [error, setError] = createSignal("");
  const [history, setHistory] = createSignal<HttpHistoryItem[]>(load(HIST, []));
  const [aiBusy, setAiBusy] = createSignal(false);

  const draft = (): HttpDraft => ({ method: method(), url: url(), headers: headers(), body: body() });
  const resolved = (): HttpDraft => {
    const v = parseVars(vars());
    const d = draft();
    return { method: d.method, url: applyVars(d.url, v), headers: applyVars(d.headers, v), body: applyVars(d.body, v) };
  };

  const fill = (d: HttpDraft) => {
    setMethod(d.method);
    setUrl(d.url);
    setHeaders(d.headers);
    setBody(d.body);
  };

  const remember = (status?: number) => {
    const item: HttpHistoryItem = { ...draft(), time: Date.now(), status };
    const list = [item, ...history().filter((h) => !(h.method === item.method && h.url === item.url && h.body === item.body))].slice(0, 40);
    setHistory(list);
    try {
      localStorage.setItem(HIST, JSON.stringify(list));
    } catch {
      /* переполнено */
    }
  };

  const send = async () => {
    const d = resolved();
    if (!d.url.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await core.httpRequest({
        method: d.method,
        url: /^https?:\/\//.test(d.url) ? d.url : "http://" + d.url,
        headers: parseHeaders(d.headers),
        body: d.method === "GET" || d.method === "HEAD" ? null : d.body,
      });
      setRes(r);
      remember(r.status);
    } catch (e) {
      setRes(null);
      setError(String(e));
      remember();
    } finally {
      setBusy(false);
    }
  };

  const onUrlPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text") ?? "";
    const parsed = text.trim().startsWith("curl ") ? fromCurl(text) : null;
    if (parsed) {
      e.preventDefault();
      fill(parsed);
      notify("Команда curl превращена в запрос");
    }
  };

  const aiCompose = async () => {
    const what = await askInput({ title: "ИИ: составить запрос", placeholder: "Например: «создать пользователя в моём API на localhost:8000»" });
    if (!what?.trim()) return;
    setAiBusy(true);
    try {
      const answer = await askAi(
        'You compose HTTP requests. Reply ONLY with JSON: {"method":"GET","url":"...","headers":"Name: value\\nName2: value","body":"..."}. ' +
          "Use realistic example values. Body is a string (pretty JSON for JSON APIs).",
        what,
      );
      const d = answer ? pickJson<HttpDraft>(answer) : null;
      if (d?.url) fill({ method: (d.method || "GET").toUpperCase(), url: d.url, headers: d.headers ?? "", body: typeof d.body === "string" ? d.body : JSON.stringify(d.body ?? "", null, 2) });
      else if (answer) notify("ИИ ответил не запросом, попробуйте описать иначе", "error");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setAiBusy(false);
    }
  };

  const aiExplain = async () => {
    const r = res();
    if (!r) return;
    setAiBusy(true);
    try {
      const answer = await askAi(
        "You explain HTTP responses to a beginner programmer: what happened, why (if it is an error), and how to fix it. Be short and concrete.",
        `${method()} ${resolved().url}\nStatus: ${r.status} ${r.statusText}\nHeaders:\n${r.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nBody (start):\n${r.body.slice(0, 4000)}`,
      );
      if (answer) notify(answer.trim());
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setAiBusy(false);
    }
  };

  const statusClass = () => {
    const s = res()?.status ?? 0;
    return s >= 500 ? "err" : s >= 400 ? "warn" : s >= 300 ? "info" : "ok";
  };

  return (
    <div class="tool http">
      <div class="http-main">
        <div class="http-line">
          <select class="http-method" value={method()} onChange={(e) => setMethod(e.currentTarget.value)}>
            <For each={METHODS}>{(m) => <option value={m}>{m}</option>}</For>
          </select>
          <input
            class="http-url"
            value={url()}
            placeholder="https://api.example.com/users  ·  можно вставить команду curl"
            onInput={(e) => setUrl(e.currentTarget.value)}
            onPaste={onUrlPaste}
            onKeyDown={(e) => e.key === "Enter" && void send()}
            data-no-translate
          />
          <button class="primary" disabled={busy()} onClick={() => void send()}>
            {busy() ? "…" : "Отправить"}
          </button>
        </div>
        <div class="tool-tabs">
          <button classList={{ on: tab() === "headers" }} onClick={() => setTab("headers")}>Заголовки</button>
          <button classList={{ on: tab() === "body" }} onClick={() => setTab("body")}>Тело</button>
          <button classList={{ on: tab() === "vars" }} onClick={() => setTab("vars")}>Переменные</button>
          <span class="grow" />
          <button disabled={aiBusy()} onClick={() => void aiCompose()} title="Составить запрос по описанию">✦ ИИ: составить</button>
          <button onClick={() => { copy(toCurl(resolved())); notify("Скопировано как curl"); }}>curl</button>
          <button onClick={() => { copy(toFetch(resolved())); notify("Скопировано как код fetch"); }}>fetch</button>
          <button onClick={() => { copy(toPython(resolved())); notify("Скопировано как код Python"); }}>Python</button>
        </div>
        <Show when={tab() === "headers"}>
          <textarea class="tool-area mono" rows={4} value={headers()} onInput={(e) => setHeaders(e.currentTarget.value)} placeholder="Authorization: Bearer {{token}}" data-no-translate />
        </Show>
        <Show when={tab() === "body"}>
          <textarea class="tool-area mono" rows={6} value={body()} onInput={(e) => setBody(e.currentTarget.value)} placeholder='{"name": "Artur"}' data-no-translate />
        </Show>
        <Show when={tab() === "vars"}>
          <textarea
            class="tool-area mono"
            rows={4}
            value={vars()}
            onInput={(e) => {
              setVars(e.currentTarget.value);
              try {
                localStorage.setItem(VARS, e.currentTarget.value);
              } catch {
                /* ничего */
              }
            }}
            data-no-translate
          />
        </Show>

        <Show when={error()}>
          <div class="tool-error">{error()}</div>
        </Show>
        <Show when={res()}>
          {(r) => (
            <div class="http-res">
              <div class="http-res-head">
                <span class={"http-status " + statusClass()}>
                  {r().status} {r().statusText}
                </span>
                <span class="dim">{r().millis} мс</span>
                <span class="dim">{formatSize(r().size)}{r().truncated ? " (обрезано)" : ""}</span>
                <span class="grow" />
                <button classList={{ on: resTab() === "body" }} onClick={() => setResTab("body")}>Ответ</button>
                <button classList={{ on: resTab() === "headers" }} onClick={() => setResTab("headers")}>Заголовки ({r().headers.length})</button>
                <button onClick={() => copy(r().body)}>Копировать</button>
                <button disabled={aiBusy()} onClick={() => void aiExplain()}>✦ Объяснить</button>
              </div>
              <Show when={resTab() === "body"}>
                <pre class="tool-out mono" data-no-translate>{prettyBody(r().body, r().headers).text || "(пустой ответ)"}</pre>
              </Show>
              <Show when={resTab() === "headers"}>
                <table class="tool-table" data-no-translate>
                  <For each={r().headers}>{([k, v]) => <tr><td>{k}</td><td>{v}</td></tr>}</For>
                </table>
              </Show>
            </div>
          )}
        </Show>
      </div>
      <div class="http-history">
        <div class="tool-sub">История</div>
        <Show when={history().length} fallback={<div class="dim small">Здесь появятся отправленные запросы</div>}>
          <For each={history()}>
            {(h) => (
              <button class="http-hist-item" onClick={() => fill(h)} title={h.url}>
                <b class={"m-" + h.method.toLowerCase()}>{h.method}</b>
                <span data-no-translate>{h.url.replace(/^https?:\/\//, "")}</span>
                <Show when={h.status}><i>{h.status}</i></Show>
              </button>
            )}
          </For>
          <button class="link small" onClick={() => { setHistory([]); localStorage.removeItem(HIST); }}>Очистить</button>
        </Show>
      </div>
    </div>
  );
}
