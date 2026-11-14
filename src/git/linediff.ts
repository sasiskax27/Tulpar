// Построчная разница для меток на полях: какие строки добавлены, изменены,
// где что-то удалено. Сначала отрезаем общие начало и конец (обычно правка
// небольшая), середину сравниваем через наибольшую общую подпоследовательность.

export interface LineChange {
  kind: "added" | "modified" | "deleted";
  /** Строки нового текста, с 1, включительно. У «deleted» start = end = строка после удаления */
  start: number;
  end: number;
}

const MAX_CELLS = 2_000_000;

export function diffLines(oldText: string, newText: string): LineChange[] {
  const a = oldText.split(/\r?\n/);
  const b = newText.split(/\r?\n/);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  if (am.length === 0 && bm.length === 0) return [];
  if (am.length === 0) return [{ kind: "added", start: pre + 1, end: pre + bm.length }];
  if (bm.length === 0) {
    const line = Math.min(pre + 1, b.length);
    return [{ kind: "deleted", start: line, end: line }];
  }
  if (am.length * bm.length > MAX_CELLS) {
    return [{ kind: "modified", start: pre + 1, end: pre + bm.length }];
  }

  // Таблица длин общей подпоследовательности для хвостов
  const n = am.length;
  const m = bm.length;
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  // Проход: собираем блоки удалений и вставок между совпадающими строками
  const changes: LineChange[] = [];
  let i = 0;
  let j = 0;
  let del = 0;
  let insStart = -1;
  const flush = () => {
    if (insStart >= 0) {
      const start = pre + insStart + 1;
      const end = pre + j;
      changes.push({ kind: del > 0 ? "modified" : "added", start, end });
    } else if (del > 0) {
      const line = Math.min(pre + j + 1, b.length);
      changes.push({ kind: "deleted", start: line, end: line });
    }
    del = 0;
    insStart = -1;
  };
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
      if (insStart < 0) insStart = j;
      j++;
    } else {
      del++;
      i++;
    }
  }
  flush();
  return changes;
}
