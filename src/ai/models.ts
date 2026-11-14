// Каталог локальных моделей для Ollama. Размер — объём загрузки в ГБ.
// Названия и размеры меняются: если модель не скачивается, проверьте её имя
// на ollama.com/library или впишите своё в поле «Другая модель».

export interface CatalogModel {
  tag: string;
  title: string;
  sizeGb: number;
  kind: "код" | "общая" | "рассуждения";
  note: string;
}

export const catalog: CatalogModel[] = [
  { tag: "qwen2.5-coder:1.5b", title: "Qwen 2.5 Coder 1.5B", sizeGb: 1.0, kind: "код", note: "Самая лёгкая. Отлично подходит для подсказок при наборе и комментариев, но ошибки почти не находит." },
  { tag: "qwen3.5:0.8b", title: "Qwen 3.5 0.8B", sizeGb: 1.3, kind: "общая", note: "Крошечная. Для самых слабых машин, код понимает плохо." },
  { tag: "lfm3:1.7b", title: "LFM3 1.7B", sizeGb: 1.7, kind: "общая", note: "Быстрая на процессоре. Для простых задач." },
  { tag: "qwen2.5-coder:3b", title: "Qwen 2.5 Coder 3B", sizeGb: 1.9, kind: "код", note: "Лёгкая модель для кода: комментарии и простые правки." },
  { tag: "llama3.2:3b", title: "Llama 3.2 3B", sizeGb: 2.0, kind: "общая", note: "Небольшая универсальная модель." },
  { tag: "phi4-mini", title: "Phi-4 Mini", sizeGb: 2.5, kind: "общая", note: "Компактная модель Microsoft." },
  { tag: "qwen3.5:4b", title: "Qwen 3.5 4B", sizeGb: 4.0, kind: "общая", note: "Хороший баланс для видеокарт на 6–8 ГБ." },
  { tag: "qwen2.5-coder:7b", title: "Qwen 2.5 Coder 7B", sizeGb: 4.7, kind: "код", note: "Проверенная модель для кода на 8 ГБ видеопамяти." },
  { tag: "deepseek-r1:8b", title: "DeepSeek R1 8B", sizeGb: 5.2, kind: "рассуждения", note: "Думает перед ответом: медленнее, но аккуратнее с ошибками." },
  { tag: "granite4.2:8b", title: "Granite 4.2 8B", sizeGb: 5.3, kind: "код", note: "Модель IBM для кода с длинным контекстом." },
  { tag: "qwen3.5:9b", title: "Qwen 3.5 9B", sizeGb: 7.6, kind: "код", note: "Заметно умнее 4B. Нужна видеокарта на 12–16 ГБ или терпение." },
  { tag: "gemma4:12b", title: "Gemma 4 12B", sizeGb: 8.0, kind: "общая", note: "Модель Google. Удобна на машинах с 16 ГБ." },
  { tag: "qwen2.5-coder:14b", title: "Qwen 2.5 Coder 14B", sizeGb: 9.0, kind: "код", note: "Сильная модель для кода среднего размера." },
  { tag: "deepseek-r1:14b", title: "DeepSeek R1 14B", sizeGb: 9.0, kind: "рассуждения", note: "Рассуждающая модель для сложных ошибок." },
  { tag: "gpt-oss:20b", title: "gpt-oss 20B", sizeGb: 14, kind: "рассуждения", note: "Открытая модель OpenAI. Один из лучших вариантов на 16 ГБ видеопамяти." },
  { tag: "devstral-small-2", title: "Devstral Small 2", sizeGb: 15, kind: "код", note: "Модель Mistral для кода и агентов." },
  { tag: "qwen3.8:27b", title: "Qwen 3.8 27B", sizeGb: 18, kind: "код", note: "Одна из сильнейших локальных моделей для кода." },
  { tag: "muse-glimmer:30b", title: "Muse Glimmer 30B", sizeGb: 18, kind: "код", note: "Сильная модель для кода на 24–32 ГБ." },
  { tag: "granite4.2:30b", title: "Granite 4.2 30B", sizeGb: 18, kind: "код", note: "Большая модель IBM для кода." },
  { tag: "qwen3-coder:30b", title: "Qwen3 Coder 30B", sizeGb: 19, kind: "код", note: "Популярная модель для кода и агентов." },
  { tag: "gemma4:26b", title: "Gemma 4 26B", sizeGb: 19, kind: "общая", note: "Быстрее других моделей своего размера." },
  { tag: "gemma4:31b", title: "Gemma 4 31B", sizeGb: 20, kind: "общая", note: "Старшая модель Gemma 4." },
  { tag: "qwen3.6:35b-coding", title: "Qwen 3.6 35B Coding", sizeGb: 24, kind: "код", note: "Для рабочих станций с 48 ГБ видеопамяти." },
  { tag: "qwen3-coder-next", title: "Qwen3 Coder Next", sizeGb: 52, kind: "код", note: "Для машин с 64 ГБ и больше." },
  { tag: "gpt-oss:120b", title: "gpt-oss 120B", sizeGb: 65, kind: "рассуждения", note: "Для серверов с 80 ГБ видеопамяти." },
];

// ---------- облачные модели Ollama ----------
// Модель с тегом :cloud считается на серверах Ollama: компьютер только отправляет
// запрос и получает ответ. Нужен вход: `ollama signin`. У бесплатного тарифа есть
// лимит на 5 часов и на неделю. Список меняется — актуальный: ollama.com/search?c=cloud

export interface CloudModel {
  tag: string;
  title: string;
  note: string;
  /** Работает на бесплатном тарифе (без гарантии: Ollama не публикует точный список) */
  free: boolean;
}

export const cloudCatalog: CloudModel[] = [
  { tag: "gpt-oss:20b-cloud", title: "gpt-oss 20B (облако)", free: true, note: "Экономная — бесплатного лимита хватает надолго. Хороший старт." },
  { tag: "nemotron-3-nano:30b-cloud", title: "Nemotron 3 Nano 30B", free: true, note: "Экономная модель NVIDIA." },
  { tag: "qwen3.5:cloud", title: "Qwen 3.5 (облако)", free: true, note: "Старшая Qwen 3.5 — намного умнее вашей 4B. Тратит лимит быстрее." },
  { tag: "deepseek-v4-flash:cloud", title: "DeepSeek V4 Flash", free: true, note: "Сильная для кода. Тратит лимит быстрее." },
  { tag: "gpt-oss:120b-cloud", title: "gpt-oss 120B (облако)", free: true, note: "Большая модель OpenAI. Тратит лимит быстрее." },
  { tag: "gemma4:cloud", title: "Gemma 4 (облако)", free: true, note: "Модель Google." },
  { tag: "minimax-m2.7:cloud", title: "MiniMax M2.7", free: true, note: "Хороша для агента." },
  { tag: "glm-5.2:cloud", title: "GLM 5.2", free: false, note: "Обычно нужна подписка Ollama Pro." },
  { tag: "kimi-k2.6:cloud", title: "Kimi K2.6", free: false, note: "Обычно нужна подписка Ollama Pro." },
  { tag: "deepseek-v4-pro:cloud", title: "DeepSeek V4 Pro", free: false, note: "Обычно нужна подписка Ollama Pro или Max." },
];

// ---------- модели OpenCode Zen ----------
// Только те, что работают через /chat/completions — так Tulpar обращается к OpenCode.
// Бесплатные модели OpenCode из других программ не работают (только в самом OpenCode).

export const opencodeModels: { id: string; note: string }[] = [
  { id: "deepseek-v4.1-flash", note: "быстрая и недорогая" },
  { id: "glm-5.3-flash", note: "быстрая, для кода" },
  { id: "minimax-m3", note: "хороша для агента" },
  { id: "kimi-k2.7-code", note: "сильная для кода" },
  { id: "qwen3.8-max", note: "старшая Qwen" },
  { id: "glm-5.3", note: "большая модель" },
  { id: "kimi-k3", note: "большая модель" },
  { id: "deepseek-v4-pro", note: "одна из самых сильных" },
  { id: "mistral-large-4", note: "Mistral" },
  { id: "minimax-m2.7", note: "предыдущая MiniMax" },
  { id: "glm-5.2", note: "предыдущая GLM" },
  { id: "kimi-k2.6", note: "предыдущая Kimi" },
];

// ---------- Claude и OpenAI ----------

export const claudeModels: { id: string; note: string }[] = [
  { id: "claude-sonnet-5-5", note: "лучший баланс ума и цены — рекомендуется" },
  { id: "claude-opus-5-5", note: "самая умная для сложных задач, дороже" },
  { id: "claude-haiku-5-5", note: "самая быстрая и дешёвая" },
  { id: "claude-fable-5-2", note: "старший уровень, самая дорогая" },
];

/** Запасной список, если сервер OpenAI не отдал свой (нет ключа или сети). */
export const openaiModels: { id: string; note: string }[] = [
  { id: "gpt-5.5", note: "старшая модель" },
  { id: "gpt-5.4-mini", note: "быстрая и недорогая" },
  { id: "gpt-5.4-nano", note: "самая дешёвая" },
];
