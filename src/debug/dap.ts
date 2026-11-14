// Клиент Debug Adapter Protocol (DAP) — того же протокола, что у отладчика
// VS Code. Транспорт общий с языковыми серверами: процесс с stdio и
// заголовком Content-Length (команды lsp_start / lsp_send в ядре).
import { core, events } from "../ipc";

export interface DapMessage {
  seq: number;
  type: "request" | "response" | "event";
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  arguments?: any;
  body?: any;
}

type Pending = { resolve: (body: any) => void; reject: (e: Error) => void };

export class DapClient {
  private seq = 1;
  private pending = new Map<number, Pending>();
  private unlisten: (() => void)[] = [];
  onEvent: (event: string, body: any) => void = () => undefined;
  /** Обратные запросы от адаптера (runInTerminal и т.п.) */
  onRequest: (command: string, args: any) => Promise<any> = async () => {
    throw new Error("не поддерживается");
  };
  onExit: (stderr: string) => void = () => undefined;

  private constructor(readonly id: number) {}

  static async start(command: string, args: string[], cwd: string | null): Promise<DapClient> {
    // Сначала подписываемся, потом запускаем — чтобы не пропустить ранние сообщения
    let client: DapClient | null = null;
    const early: string[] = [];
    let startedId = -1;
    const un1 = await events.onLspMessage((sid, message) => {
      if (client && sid === client.id) client.handle(message);
      else if (startedId < 0) early.push(`${sid}\u0000${message}`);
    });
    const un2 = await events.onLspExit((sid, stderr) => {
      if (client && sid === client.id) client.exited(stderr);
    });
    try {
      startedId = await core.lspStart(command, args, cwd);
    } catch (e) {
      un1();
      un2();
      throw e;
    }
    client = new DapClient(startedId);
    client.unlisten.push(un1, un2);
    for (const item of early) {
      const [sid, msg] = item.split("\u0000");
      if (Number(sid) === startedId) client.handle(msg);
    }
    return client;
  }

  request<T = any>(command: string, args?: unknown, timeoutMs = 30_000): Promise<T> {
    const seq = this.seq++;
    const msg = { seq, type: "request", command, arguments: args };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(seq)) reject(new Error(`отладчик не ответил на «${command}»`));
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: (b) => (clearTimeout(timer), resolve(b)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      void core.lspSend(this.id, JSON.stringify(msg)).catch((e) => {
        this.pending.delete(seq);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  private respond(request: DapMessage, success: boolean, body?: unknown, message?: string) {
    const msg = { seq: this.seq++, type: "response", request_seq: request.seq, command: request.command, success, body, message };
    void core.lspSend(this.id, JSON.stringify(msg)).catch(() => undefined);
  }

  private handle(raw: string) {
    let msg: DapMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "response") {
      const p = this.pending.get(msg.request_seq ?? -1);
      if (!p) return;
      this.pending.delete(msg.request_seq!);
      if (msg.success) p.resolve(msg.body ?? {});
      else p.reject(new Error(msg.body?.error?.format ?? msg.message ?? "ошибка отладчика"));
    } else if (msg.type === "event") {
      this.onEvent(msg.event ?? "", msg.body ?? {});
    } else if (msg.type === "request") {
      this.onRequest(msg.command ?? "", msg.arguments ?? {}).then(
        (body) => this.respond(msg, true, body),
        (e) => this.respond(msg, false, undefined, e instanceof Error ? e.message : String(e)),
      );
    }
  }

  private exited(stderr: string) {
    for (const p of this.pending.values()) p.reject(new Error("отладчик завершился"));
    this.pending.clear();
    this.dispose();
    this.onExit(stderr);
  }

  dispose() {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
  }

  async stop() {
    this.dispose();
    await core.lspStop(this.id).catch(() => undefined);
  }
}
