# Tulpar

Быстрый редактор кода с ощущением VS Code: без телеметрии, с любыми AI-агентами и настраиваемый целиком.

> Ранняя стадия: идёт неделя 1. Архитектура и план — в [ARCHITECTURE.md](ARCHITECTURE.md).

## Что уже есть

- Редактор на Monaco (движок VS Code): подсветка ~80 языков, мультикурсор, мини-карта, поиск и замена (`Ctrl+F` / `Ctrl+H`)
- Открытие папки, дерево файлов, автообновление при изменениях на диске
- **Проводник:** создать файл или папку (можно сразу с путём: `src/utils/x.ts`), переименовать (`F2`), удалить в корзину (`Delete`), контекстное меню, управление стрелками, подсветка открытого файла
- **Git** (`Ctrl+Shift+G`): изменённые файлы, разница «коммит ↔ сейчас» бок о бок, подготовка и откат, коммит (`Ctrl+Enter`), сообщение коммита от ИИ, ветки, push / pull, цветные метки изменённых строк на полях
- **Сборка и запуск:** Tulpar сам находит в проекте Maven, Gradle, npm / pnpm / yarn / bun, Cargo, Go, Python (pip, Poetry, uv), Make, CMake, .NET, Docker, Bundler, Composer, Dart / Flutter, Mix и предлагает их задачи — собрать, тесты, запустить (`Ctrl+Shift+B`). Кнопка ▶ (`Ctrl+F5`) запускает текущий файл: Python, JavaScript, TypeScript, Go, Rust, C, C++, Java, Kotlin, C#, PHP, Ruby, Lua, Perl, R, Julia, Dart, Swift, Scala, Bash, PowerShell и другие. Всё выполняется во встроенном терминале
- **Перетаскивание:** файлы и папки тянутся мышью на другую папку, файлы из проводника системы бросаются прямо в дерево (в том числе с другого диска) — в конце меню «Переместить / Копировать»
- **Поиск по проекту** (`Ctrl+Shift+F`): учёт регистра, слово целиком, регулярные выражения, фильтр файлов, замена во всех файлах (открытые меняются в редакторе с отменой через `Ctrl+Z`)
- Вкладки, сохранение, метка «не сохранено», восстановление сессии
- Палитра команд `Ctrl+Shift+P` и переход к файлу `Ctrl+P` (с учётом `.gitignore`)
- `settings.json`, `keybindings.json`, `layout.json` в формате VS Code — применяются на лету
- **Языковые серверы (LSP):** автодополнение с автоимпортом, ошибки, подсказки при наведении, подсказки параметров, переход к определению (`F12`), поиск использований (`Shift+F12`), переименование (`F2`), форматирование (`Shift+Alt+F`)
- **Встроенный терминал** (`Ctrl+\``): несколько вкладок, PowerShell на Windows и ваша оболочка на macOS и Linux, копирование и вставка, история сохраняется при скрытии панели
- **Окно настроек** (`Ctrl+,`): шрифт, отступы, тема, терминал, ИИ — без правки файлов; всё применяется сразу
- **Фоновая картинка:** перетащите PNG или JPG в окно; яркость, размытие и размер настраиваются
- **ИИ по правому клику:** выделите код → «ИИ: Добавить комментарии», «Исправить ошибки», «Упростить», «Объяснить», «Свой запрос» (`Ctrl+I`). Работает с локальной Ollama, любым OpenAI-совместимым сервером или Claude
- **Чат с ИИ** (`Ctrl+Alt+I`): ответы потоком, ИИ видит открытый файл или выделение, приложенные файлы и список файлов проекта; блоки кода с кнопками «Копировать» и «Вставить», ссылки `файл:строка` открывают нужное место; работает с Ollama, OpenAI-совместимыми серверами и Claude
- **Свои действия ИИ:** в настройках задаёте название и инструкцию — появляется пункт «ИИ: …» в меню по правому клику и в палитре
- **Восстановление после сбоя:** несохранённые правки сохраняются в резервную копию; если Tulpar закрылся (вылет, выключили свет), при следующем открытии папки он предложит их вернуть
- **Языковые серверы одной кнопкой:** если сервер не найден, в уведомлении кнопка «Установить» — команда запускается во встроенном терминале
- **Подсказки ИИ при наборе:** серый текст продолжения, `Tab` — принять. С Ollama модель видит код и до, и после курсора, поэтому даже маленькая `qwen2.5-coder:1.5b` подсказывает быстро и к месту. Включается в настройках, раздел «ИИ»

## Языки

**Подсветка** — около 80 языков сразу (движок Monaco).

**Умные функции** (автодополнение, ошибки, определение, переименование):
- встроены: JavaScript, TypeScript, JSON, HTML, CSS, SCSS, Less;
- настроены — нужен языковой сервер, Tulpar предложит установить его кнопкой:

| Язык | Сервер | Установка |
|---|---|---|
| Rust | rust-analyzer | `rustup component add rust-analyzer` |
| Python | basedpyright | `pip install basedpyright` |
| Go | gopls | `go install golang.org/x/tools/gopls@latest` |
| C / C++ / Objective-C | clangd | `winget install LLVM.LLVM` / `brew install llvm` / `apt install clangd` |
| Java | jdtls | `scoop install jdtls` / `brew install jdtls` |
| C# | csharp-ls | `dotnet tool install --global csharp-ls` |
| PHP | intelephense | `npm install -g intelephense` |
| Lua | lua-language-server | `winget install LuaLS.lua-language-server` / `brew install lua-language-server` |
| Kotlin | kotlin-language-server | `scoop install kotlin-language-server` / `brew install kotlin-language-server` |
| Ruby | ruby-lsp | `gem install ruby-lsp` |
| Scala | metals | `cs install metals` |
| Dart | входит в Dart SDK | — |
| Swift | sourcekit-lsp, входит в Swift | — |
| R | languageserver | `Rscript -e "install.packages('languageserver')"` |
| Bash | bash-language-server | `npm install -g bash-language-server` |
| YAML | yaml-language-server | `npm install -g yaml-language-server` |
| Dockerfile | docker-langserver | `npm install -g dockerfile-language-server-nodejs` |

Сервер запускается, только когда открыт файл его языка.

Любой другой язык — одна строка в `languages.json` (палитра → «Настройки: Открыть languages.json»):

```jsonc
{
  "zig": { "command": "zls" },
  "typescript": { "command": "typescript-language-server", "args": ["--stdio"] }
}
```

## Запуск

Нужны:

- [Rust](https://rustup.rs)
- [Node.js 20+](https://nodejs.org)
- Системные пакеты для Tauri:
  - **Windows** — [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) («Разработка классических приложений на C++»); WebView2 уже есть в Windows 10/11
  - **macOS** — `xcode-select --install`
  - **Linux (Debian/Ubuntu)** — `sudo apt install libwebkit2gtk-4.1-dev build-essential libayatana-appindicator3-dev librsvg2-dev`

```bash
npm install
npm run tauri dev
```

Первая сборка Rust займёт несколько минут, следующие — секунды.

## Сочетания клавиш

| Клавиши | Действие |
|---|---|
| `Ctrl+Shift+P` / `F1` | Все команды |
| `Ctrl+P` | Перейти к файлу |
| `Ctrl+K Ctrl+O` | Открыть папку |
| `Ctrl+S` / `Ctrl+Alt+S` | Сохранить / сохранить всё |
| `Ctrl+W` | Закрыть вкладку |
| `Ctrl+Tab` | Следующая вкладка |
| `Ctrl+B` | Боковая панель |
| `Ctrl+Shift+E` | Проводник |
| `Ctrl+Shift+G` | Git |
| `Ctrl+G` | Перейти к строке |
| `Ctrl+Shift+F` | Поиск по проекту (выделенный текст сразу становится запросом) |
| ``Ctrl+` `` | Показать терминал / перейти в него / скрыть |
| ``Ctrl+Shift+` `` | Новый терминал |
| `Ctrl+1` | Вернуться в редактор |
| `Ctrl+K Z` | Режим фокуса |
| `Ctrl+,` | Настройки |
| `Ctrl+Alt+I` | Чат с ИИ |
| `Ctrl+Shift+B` | Задачи проекта: сборка, тесты, запуск |
| `Ctrl+F5` | Запустить текущий файл |
| `Ctrl+I` | Свой запрос к ИИ по выделенному коду |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Размер шрифта: больше / меньше / сбросить |

На macOS вместо `Ctrl` — `Cmd`.

## ИИ

Откройте настройки (`Ctrl+,`), раздел «ИИ», и выберите один из вариантов:

- **Ollama** — бесплатно, модель работает на вашем компьютере, код никуда не уходит. В разделе «Локальный ИИ» — каталог из 25 моделей: Tulpar показывает, какие запустятся на вашем железе, скачивает выбранную с прогрессом и сам подключает её.
- **OpenAI-совместимый** — OpenAI, OpenRouter, LM Studio и другие: адрес сервера, модель и ключ.
- **Claude** — ключ API из консоли Anthropic; модель по умолчанию `claude-sonnet-5-5`.

Tulpar отправляет код только по вашей команде и только на указанный сервер. Ключ хранится открытым текстом в `settings.json` — не выкладывайте этот файл.

## Настройки

Файлы лежат в папке настроек (`~/.config/tulpar` на Linux, `~/Library/Application Support/tulpar` на macOS, `%APPDATA%\tulpar` на Windows). Открыть их можно из палитры команд: «Настройки: Открыть settings.json» и т.д.

## Структура

```
src/          интерфейс (TypeScript + SolidJS)
src-tauri/    ядро (Rust + Tauri)
docs/         задачи и заметки
```

## Принципы

Ноль телеметрии. Быстрый старт. Умный по требованию. Маленькое ядро. Настраивается всё.
