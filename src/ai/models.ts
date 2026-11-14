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
  { tag: "qwen2.5-coder:1.5b", title: "Qwen 2.5 Coder 1.5B", sizeGb: 1.0, kind: "код", note: "Самая лёгкая модель для кода. Работает даже без видеокарты." },
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
