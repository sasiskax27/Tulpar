// Простейшее операционное преобразование (OT) для совместной правки текста.
// Операция — «на позиции pos удалить del символов и вставить ins».
export interface Op {
  pos: number;
  del: number;
  ins: string;
}

export const noop = (pos = 0): Op => ({ pos, del: 0, ins: "" });
export const isNoop = (o: Op) => o.del === 0 && o.ins === "";

export function apply(text: string, o: Op): string {
  const pos = Math.max(0, Math.min(o.pos, text.length));
  return text.slice(0, pos) + o.ins + text.slice(Math.min(text.length, pos + o.del));
}

/** Одна операция, превращающая a в b (общее начало и конец). */
export function diff(a: string, b: string): Op {
  if (a === b) return noop();
  let s = 0;
  const min = Math.min(a.length, b.length);
  while (s < min && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  let e = 0;
  while (e < min - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
  return { pos: s, del: a.length - s - e, ins: b.slice(s, b.length - e) };
}

/**
 * Преобразовать a так, чтобы её можно было применить после b (обе сделаны
 * от одного и того же текста). aFirst — при равенстве позиций a «раньше».
 * Для сходимости пары вызывают как transform(a, b, true) и transform(b, a, false).
 */
export function transform(a: Op, b: Op, aFirst: boolean): Op {
  const aS = a.pos, aE = a.pos + a.del, bS = b.pos, bE = b.pos + b.del, bL = b.ins.length;
  // Две вставки в одно место
  if (a.del === 0 && b.del === 0 && aS === bS) return aFirst ? { ...a } : { ...a, pos: aS + bL };
  // b целиком до a
  if (bE <= aS) return { ...a, pos: aS + bL - b.del };
  // b целиком после a
  if (bS >= aE) return { ...a };
  // Пересечение
  const aContainsB = aS <= bS && bE <= aE;
  const bContainsA = bS <= aS && aE <= bE;
  if (aContainsB && (!bContainsA || aFirst)) return { pos: aS, del: a.del - b.del + bL, ins: a.ins };
  if (bContainsA) return noop(bS + bL);
  if (aS < bS) return { pos: aS, del: bS - aS, ins: a.ins };
  return { pos: bS + bL, del: aE - bE, ins: a.ins };
}
