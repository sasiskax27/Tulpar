// Каталог ИИ-сервисов для настроек и магазина: что бесплатно, где взять ключ,
// как войти без ручного копирования. Переключение сервиса сохраняет модель,
// адрес и ключ прежнего, чтобы вернуться к нему одним нажатием.
import { createSignal } from "solid-js";
import { core } from "../ipc";
import { settings, updateSetting } from "../config/store";
import { notify, notifyError } from "../app/notify";
import { providers } from "./ai";

export type Login = "openrouter" | "github" | "ollama";

export interface AiService {
  id: string;
  name: string;
  icon: string;
  tags: string[];
  note: string;
  /** Страница, где создаётся ключ */
  keyUrl?: string;
  login?: Login;
  needsKey: boolean;
}

export const services: AiService[] = [
  { id: "gemini", name: "Google Gemini", icon: "✨", tags: ["бесплатно", "без карты", "умный"], keyUrl: "https://aistudio.google.com/apikey", needsKey: true, note: "Лучший бесплатный старт: сильные модели и большой контекст. На бесплатном тарифе Google может использовать запросы для улучшения своих продуктов — секретный код лучше не отправлять." },
  { id: "groq", name: "Groq", icon: "⚡", tags: ["бесплатно", "очень быстро"], keyUrl: "https://console.groq.com/keys", needsKey: true, note: "Отвечает почти мгновенно: Llama, Qwen, GPT-OSS. Хорош для чата." },
  { id: "cerebras", name: "Cerebras", icon: "🚀", tags: ["бесплатно", "очень быстро"], keyUrl: "https://cloud.cerebras.ai", needsKey: true, note: "Тысячи токенов в секунду. Контекст на бесплатном тарифе небольшой — для коротких вопросов." },
  { id: "openrouter", name: "OpenRouter", icon: "🔀", tags: ["вход в браузере", "есть бесплатные"], keyUrl: "https://openrouter.ai/keys", login: "openrouter", needsKey: true, note: "Сотни моделей через один аккаунт. Вход в браузере — ключ подставится сам. Модели «:free» бесплатные, с дневным лимитом." },
  { id: "github", name: "GitHub Models", icon: "🐙", tags: ["вход через GitHub", "бесплатно"], keyUrl: "https://github.com/settings/personal-access-tokens/new", login: "github", needsKey: true, note: "GPT, Llama, DeepSeek по аккаунту GitHub. Лимиты маленькие — для чата, не для больших задач агента. Токену нужно право models:read." },
  { id: "huggingface", name: "Hugging Face", icon: "🤗", tags: ["тысячи моделей", "немного бесплатно"], keyUrl: "https://huggingface.co/settings/tokens", needsKey: true, note: "Открытые модели с Hugging Face через один токен (право «Inference Providers»). Бесплатных кредитов немного; суффикс :fastest выбирает самого быстрого поставщика." },
  { id: "mistral", name: "Mistral", icon: "🌬", tags: ["бесплатный план", "Codestral"], keyUrl: "https://console.mistral.ai/api-keys", needsKey: true, note: "Бесплатный план Experiment, модель Codestral сделана для кода." },
  { id: "ollama", name: "Ollama", icon: "🦙", tags: ["на компьютере", "без интернета"], login: "ollama", needsKey: false, note: "Модели прямо на вашем компьютере, ничего не уходит в интернет. Для слабых ПК — облачные модели Ollama (вход через ollama signin)." },
  { id: "opencode", name: "OpenCode Zen", icon: "🧩", tags: ["платно"], keyUrl: "https://opencode.ai/console", needsKey: true, note: "Облачные модели OpenCode, оплата за запросы." },
  { id: "anthropic", name: "Claude", icon: "🟠", tags: ["платно", "лучший для кода"], keyUrl: "https://console.anthropic.com/settings/keys", needsKey: true, note: "Claude через API, нужен ключ из консоли Anthropic." },
  { id: "openai", name: "OpenAI-совместимый", icon: "🔌", tags: ["свой сервер"], needsKey: true, note: "Любой сервер с OpenAI-совместимым API: OpenAI, LM Studio, свой сервер." },
];

export const serviceById = (id: string) => services.find((s) => s.id === id);

/** Сменить сервис: запомнить настройки текущего и вернуть сохранённые для нового. */
export function switchService(id: string) {
  const cfg = settings();
  const current = String(cfg["tulpar.ai.provider"]);
  if (current === id) return;
  const profiles = { ...(cfg["tulpar.ai.profiles"] ?? {}) };
  if (current !== "none") profiles[current] = { model: cfg["tulpar.ai.model"], baseUrl: cfg["tulpar.ai.baseUrl"], apiKey: cfg["tulpar.ai.apiKey"] };
  const next = profiles[id];
  updateSetting("tulpar.ai.profiles", profiles);
  updateSetting("tulpar.ai.provider", id as never);
  updateSetting("tulpar.ai.model", next?.model ?? "");
  updateSetting("tulpar.ai.baseUrl", next?.baseUrl ?? "");
  updateSetting("tulpar.ai.apiKey", next?.apiKey ?? "");
}

// ---------- вход ----------

const [loginBusy, setLoginBusy] = createSignal<string | null>(null);
export { loginBusy };

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const OPENROUTER_PORT = 51423;

/** OpenRouter OAuth PKCE: браузер → вход → ключ приходит в Tulpar сам. */
export async function loginOpenRouter() {
  if (loginBusy()) return;
  setLoginBusy("openrouter");
  try {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = b64url(verifierBytes);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const callback = `http://localhost:${OPENROUTER_PORT}/callback`;
    const wait = core.oauthCapture(OPENROUTER_PORT, 600);
    const url =
      `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&key_label=Tulpar`;
    await core.openUrl(url);
    notify("Войдите в OpenRouter в открывшемся браузере");
    const query = new URLSearchParams(await wait);
    const code = query.get("code");
    if (!code) throw new Error("вход отменён");
    if (query.get("state") && query.get("state") !== state) throw new Error("ответ не от этого входа");
    const res = await core.httpRequest({
      method: "POST",
      url: "https://openrouter.ai/api/v1/auth/keys",
      headers: [["Content-Type", "application/json"]],
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      timeoutSecs: 30,
    });
    const key = res.status === 200 ? (JSON.parse(res.body).key as string | undefined) : undefined;
    if (!key) throw new Error(`OpenRouter не выдал ключ (${res.status})`);
    switchService("openrouter");
    updateSetting("tulpar.ai.apiKey", key);
    if (!settings()["tulpar.ai.model"]) updateSetting("tulpar.ai.model", "openai/gpt-oss-120b:free");
    notify("Готово: вы вошли в OpenRouter");
  } catch (e) {
    notifyError("Вход в OpenRouter", e);
  } finally {
    setLoginBusy(null);
  }
}

/** GitHub Models: берём токен у GitHub CLI; если его нет — открываем страницу токена. */
export async function loginGitHub() {
  if (loginBusy()) return;
  setLoginBusy("github");
  try {
    const token = await core.githubCliToken();
    switchService("github");
    updateSetting("tulpar.ai.apiKey", token);
    if (!settings()["tulpar.ai.model"]) updateSetting("tulpar.ai.model", providers.github.model);
    notify("Готово: вход взят из GitHub CLI");
  } catch {
    notify("GitHub CLI не найден или не вошёл. Создайте токен с правом «Models: read» и вставьте его в поле «Ключ API».");
    switchService("github");
    void core.openUrl("https://github.com/settings/personal-access-tokens/new");
  } finally {
    setLoginBusy(null);
  }
}

/** Ollama Cloud: `ollama signin` во вкладке терминала. */
export async function loginOllama() {
  const { runInTerminal } = await import("../terminal/sessions");
  runInTerminal("ollama signin");
}

export function login(kind: Login) {
  if (kind === "openrouter") return loginOpenRouter();
  if (kind === "github") return loginGitHub();
  return loginOllama();
}

// ---------- проверка ----------

/** Короткий тестовый запрос: работает ли ключ, модель и сколько ждать ответа. */
export async function testConnection(): Promise<void> {
  const { aiBase } = await import("./ai");
  const base = aiBase();
  if (!base) return;
  setLoginBusy("test");
  const started = performance.now();
  try {
    const answer = await core.aiComplete({ ...base, system: "Reply with one word.", prompt: "Say: ok" });
    const ms = Math.round(performance.now() - started);
    notify(`Работает ✅ ${base.model} ответила за ${(ms / 1000).toFixed(1)} с: «${answer.trim().slice(0, 40)}»`);
  } catch (e) {
    notifyError(`Не работает: ${base.model}`, e);
  } finally {
    setLoginBusy(null);
  }
}
