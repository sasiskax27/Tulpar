# Tulpar

Быстрый редактор кода с ощущением VS Code: без телеметрии, с любыми AI-агентами и настраиваемый целиком.

> Ранняя стадия: идёт неделя 1. Архитектура и план — в [ARCHITECTURE.md](ARCHITECTURE.md).

## Что уже есть

- Редактор на Monaco (движок VS Code): подсветка ~80 языков, мультикурсор, мини-карта, поиск и замена (`Ctrl+F` / `Ctrl+H`)
- Открытие папки, дерево файлов, автообновление при изменениях на диске
- Вкладки, сохранение, метка «не сохранено», восстановление сессии
- Палитра команд `Ctrl+Shift+P` и переход к файлу `Ctrl+P` (с учётом `.gitignore`)
- `settings.json`, `keybindings.json`, `layout.json` в формате VS Code — применяются на лету

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
| `Ctrl+K Z` | Режим фокуса |
| `Ctrl+,` | Настройки |

На macOS вместо `Ctrl` — `Cmd`.

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
