// Курсы учебного режима. Python проверяется настоящим запуском (ядро
// блокнотов), HTML/CSS — разбором страницы. Проверка — обычный код Python
// с assert или функция над документом.

export interface Lesson {
  id: string;
  title: string;
  /** Объяснение и задание (Markdown) */
  text: string;
  starter: string;
  /** Python: код с assert, выполняется после кода ученика. Может читать __out__ — вывод программы. */
  check?: string;
  /** Python: что подать на input() */
  input?: string[];
  /** HTML: проверка документа; вернуть null — всё верно, иначе текст ошибки */
  checkHtml?: (doc: Document) => string | null;
}

export interface Course {
  id: string;
  title: string;
  language: "python" | "html";
  emoji: string;
  lessons: Lesson[];
}

export const COURSES: Course[] = [
  {
    id: "python",
    title: "Python с нуля",
    language: "python",
    emoji: "🐍",
    lessons: [
      {
        id: "py-print",
        title: "Первая программа",
        text: "Команда `print()` выводит текст на экран. Текст пишут в кавычках.\n\n**Задание:** выведите строку `Привет, мир!`",
        starter: "# Напишите код ниже\n",
        check: "assert 'Привет, мир!' in __out__, 'Программа должна вывести: Привет, мир!'",
      },
      {
        id: "py-vars",
        title: "Переменные",
        text: "Переменная — это имя для значения: `age = 16`. Потом её можно использовать: `print(age)`.\n\n**Задание:** создайте переменную `name` со своим именем и переменную `age` со своим возрастом (числом). Выведите их.",
        starter: "name = \nage = \n",
        check: "assert isinstance(name, str) and name.strip(), 'name должна быть непустой строкой в кавычках'\nassert isinstance(age, int), 'age должна быть целым числом без кавычек'",
      },
      {
        id: "py-math",
        title: "Арифметика",
        text: "Python считает: `+ - * /`, целое деление `//`, остаток `%`, степень `**`.\n\n**Задание:** в переменную `seconds` запишите, сколько секунд в сутках (посчитайте выражением, а не вручную).",
        starter: "seconds = \nprint(seconds)\n",
        check: "assert seconds == 86400, f'В сутках 86400 секунд, а у вас {seconds}'",
      },
      {
        id: "py-input",
        title: "Ввод с клавиатуры",
        text: "`input()` читает строку, `int()` превращает её в число.\n\n**Задание:** прочитайте два числа и выведите их сумму.",
        starter: "a = int(input())\nb = \n",
        input: ["7", "5"],
        check: "assert '12' in __out__, 'Для чисел 7 и 5 программа должна вывести 12'",
      },
      {
        id: "py-if",
        title: "Условия",
        text: "`if` выполняет код, только если условие верно; `else` — иначе.\n\n```python\nif x > 0:\n    print('плюс')\nelse:\n    print('не плюс')\n```\n\n**Задание:** напишите функцию `is_adult(age)`, которая возвращает `True`, если возраст 18 и больше.",
        starter: "def is_adult(age):\n    ...\n",
        check: "assert is_adult(18) is True, 'is_adult(18) должна вернуть True'\nassert is_adult(25) is True\nassert is_adult(17) is False, 'is_adult(17) должна вернуть False'",
      },
      {
        id: "py-loop",
        title: "Циклы",
        text: "`for i in range(1, 6):` повторяет код для i = 1, 2, 3, 4, 5.\n\n**Задание:** функция `total(n)` должна вернуть сумму чисел от 1 до n.",
        starter: "def total(n):\n    s = 0\n    \n    return s\n",
        check: "assert total(5) == 15, f'total(5) должно быть 15, а не {total(5)}'\nassert total(1) == 1\nassert total(100) == 5050",
      },
      {
        id: "py-list",
        title: "Списки",
        text: "Список хранит много значений: `nums = [3, 1, 2]`. Есть `len()`, `max()`, `sum()`, `sorted()`.\n\n**Задание:** функция `average(nums)` возвращает среднее арифметическое списка.",
        starter: "def average(nums):\n    ...\n",
        check: "assert average([2, 4, 6]) == 4, 'average([2, 4, 6]) должно быть 4'\nassert abs(average([1, 2]) - 1.5) < 1e-9",
      },
      {
        id: "py-str",
        title: "Строки",
        text: "Строки умеют многое: `s.upper()`, `s.lower()`, `s[::-1]` — задом наперёд, `s.replace(a, b)`.\n\n**Задание:** функция `is_palindrome(s)` — True, если слово читается одинаково в обе стороны (без учёта регистра).",
        starter: "def is_palindrome(s):\n    ...\n",
        check: "assert is_palindrome('Шалаш') is True, 'Шалаш — палиндром'\nassert is_palindrome('казак') is True\nassert is_palindrome('python') is False",
      },
      {
        id: "py-dict",
        title: "Словари",
        text: "Словарь хранит пары ключ → значение: `ages = {'Артур': 16}`. `ages['Артур']` вернёт 16.\n\n**Задание:** функция `count_words(text)` возвращает словарь: слово → сколько раз встретилось.",
        starter: "def count_words(text):\n    counts = {}\n    for word in text.split():\n        ...\n    return counts\n",
        check: "r = count_words('а б а в а б')\nassert r == {'а': 3, 'б': 2, 'в': 1}, f'Получилось {r}'",
      },
      {
        id: "py-game",
        title: "Мини-проект: угадай число",
        text: "Соберём всё вместе. Функция `hint(secret, guess)` возвращает `'больше'`, если загаданное число больше, `'меньше'` — если меньше, и `'угадал'`, если равно.\n\nПотом можете дописать саму игру с `random.randint` и циклом `while`.",
        starter: "def hint(secret, guess):\n    ...\n",
        check: "assert hint(50, 30) == 'больше'\nassert hint(50, 70) == 'меньше'\nassert hint(50, 50) == 'угадал'",
      },
    ],
  },
  {
    id: "web",
    title: "Первый сайт",
    language: "html",
    emoji: "🌐",
    lessons: [
      {
        id: "web-h1",
        title: "Заголовок и текст",
        text: "HTML состоит из тегов: `<h1>` — главный заголовок, `<p>` — абзац.\n\n**Задание:** добавьте заголовок `<h1>` со своим именем и абзац `<p>` о себе.",
        starter: "<!DOCTYPE html>\n<html>\n<body>\n\n</body>\n</html>\n",
        checkHtml: (d) => (!d.querySelector("h1")?.textContent?.trim() ? "Нет заголовка <h1> с текстом" : !d.querySelector("p")?.textContent?.trim() ? "Нет абзаца <p> с текстом" : null),
      },
      {
        id: "web-link",
        title: "Ссылки и картинки",
        text: "`<a href=\"https://…\">текст</a>` — ссылка, `<img src=\"…\" alt=\"описание\">` — картинка.\n\n**Задание:** добавьте ссылку на любой сайт и картинку с атрибутом `alt`.",
        starter: "<!DOCTYPE html>\n<html>\n<body>\n  <h1>Мои ссылки</h1>\n\n</body>\n</html>\n",
        checkHtml: (d) =>
          !d.querySelector("a[href^='http']") ? "Нужна ссылка <a href=\"https://…\">" : !d.querySelector("img[alt]:not([alt=''])") ? "Нужна картинка <img> с непустым alt" : null,
      },
      {
        id: "web-list",
        title: "Списки",
        text: "`<ul>` — список с точками, каждый пункт в `<li>`.\n\n**Задание:** сделайте список из трёх своих увлечений.",
        starter: "<!DOCTYPE html>\n<html>\n<body>\n  <h2>Мои увлечения</h2>\n\n</body>\n</html>\n",
        checkHtml: (d) => ((d.querySelectorAll("ul > li").length >= 3 ? null : "Нужен <ul> минимум с тремя <li>")),
      },
      {
        id: "web-css",
        title: "Стили CSS",
        text: "CSS задаёт внешний вид. Внутри `<style>`: `h1 { color: tomato; }`.\n\n**Задание:** сделайте фон страницы (`body`) тёмным, а текст — светлым. Нажмите «▶ Показать», чтобы увидеть результат.",
        starter: "<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    body {\n      \n    }\n  </style>\n</head>\n<body>\n  <h1>Тёмная тема</h1>\n</body>\n</html>\n",
        checkHtml: (d) => {
          const css = Array.from(d.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
          return /body\s*\{[^}]*background(-color)?\s*:/i.test(css) && /body\s*\{[^}]*[^-]color\s*:/i.test(css) ? null : "В правиле body нужны и background, и color";
        },
      },
      {
        id: "web-button",
        title: "Кнопка с JavaScript",
        text: "JavaScript оживляет страницу: `button.addEventListener('click', () => { … })`.\n\n**Задание:** сделайте кнопку с `id=\"btn\"` и скрипт, который по клику меняет текст заголовка.",
        starter: "<!DOCTYPE html>\n<html>\n<body>\n  <h1 id=\"title\">Нажми кнопку</h1>\n  \n  <script>\n    \n  </script>\n</body>\n</html>\n",
        checkHtml: (d) => {
          const js = Array.from(d.querySelectorAll("script")).map((s) => s.textContent ?? "").join("\n");
          return !d.querySelector("button#btn") ? "Нужна кнопка <button id=\"btn\">" : !/addEventListener\s*\(\s*['"]click|onclick/i.test(js) ? "Нужен обработчик клика (addEventListener('click', …))" : null;
        },
      },
    ],
  },
];
