// Протокол совместной правки: хозяин — источник правды (версии по порядку),
// у гостя не больше одной неподтверждённой операции, остальное копится и
// отправляется одной операцией после подтверждения.
import { apply, diff, isNoop, transform, type Op } from "./ot";

export interface HistoryItem {
  v: number;
  op: Op;
  from: string;
  id?: string;
}

export class HostDoc {
  history: HistoryItem[] = [];
  constructor(public text: string, public version = 0) {}

  /** Правка хозяина (уже применена к тексту снаружи или применяется тут). */
  local(op: Op, from = "host", id?: string): HistoryItem {
    this.text = apply(this.text, op);
    this.version++;
    const item = { v: this.version, op, from, id };
    this.history.push(item);
    if (this.history.length > 5000) this.history.splice(0, this.history.length - 4000);
    return item;
  }

  /** Операция гостя от версии base → преобразованная для текущего текста или null (слишком старая). */
  rebase(base: number, op: Op): Op | null {
    if (base > this.version) return null;
    const oldest = this.history[0]?.v ?? this.version + 1;
    if (base < this.version && base + 1 < oldest) return null;
    let o = op;
    for (const h of this.history) if (h.v > base) o = transform(o, h.op, false);
    return o;
  }
}

export class GuestDoc {
  /** Текст, каким его видит хозяин после нашей неподтверждённой операции */
  sentText: string;
  outstanding: { id: string; op: Op } | null = null;
  private counter = 0;

  constructor(public text: string, public version: number, private makeId: () => string = () => String(++this.counter)) {
    this.sentText = text;
  }

  /** Локальная правка; вернёт операцию для отправки, если сейчас можно. */
  edit(newText: string): { id: string; base: number; op: Op } | null {
    this.text = newText;
    return this.flush();
  }

  flush(): { id: string; base: number; op: Op } | null {
    if (this.outstanding) return null;
    const op = diff(this.sentText, this.text);
    if (isNoop(op)) return null;
    const id = this.makeId();
    this.outstanding = { id, op };
    this.sentText = this.text;
    return { id, base: this.version, op };
  }

  /**
   * Пришла операция от хозяина (версия v). Своё подтверждение — вернёт null и
   * возможно следующую порцию в send; чужая — вернёт операцию для локального текста.
   */
  receive(v: number, op: Op, id: string | undefined, mine: boolean): { local: Op | null; send: { id: string; base: number; op: Op } | null } {
    this.version = v;
    if (mine && this.outstanding && id === this.outstanding.id) {
      this.outstanding = null;
      return { local: null, send: this.flush() };
    }
    let r = op;
    if (this.outstanding) {
      r = transform(op, this.outstanding.op, true);
      // Наша операция у хозяина будет преобразована против op
      this.outstanding = { id: this.outstanding.id, op: transform(this.outstanding.op, op, false) };
    }
    const buffer = diff(this.sentText, this.text);
    this.sentText = apply(this.sentText, r);
    const local = isNoop(buffer) ? r : transform(r, buffer, true);
    this.text = apply(this.text, local);
    return { local, send: null };
  }
}
