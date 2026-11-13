// JSON-RPC клиент одного языкового сервера. Ядро на Rust только пересылает байты,
// а запросы, ответы и уведомления разбираются здесь.
import { core } from "../ipc";

type Handler = (params: any) => unknown;

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

export class LspClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private notificationHandlers = new Map<string, Handler>();
  private requestHandlers = new Map<string, Handler>();
  capabilities: any = {};
  alive = true;

  constructor(readonly serverId: number, readonly name: string) {}

  request<T = any>(method: string, params: unknown): Promise<T> {
    if (!this.alive) return Promise.reject(new Error(`${this.name} остановлен`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params }).catch((e) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.alive) return;
    void this.send({ jsonrpc: "2.0", method, params }).catch(() => undefined);
  }

  onNotification(method: string, handler: Handler) {
    this.notificationHandlers.set(method, handler);
  }

  onRequest(method: string, handler: Handler) {
    this.requestHandlers.set(method, handler);
  }

  private send(message: unknown) {
    return core.lspSend(this.serverId, JSON.stringify(message));
  }

  /** Сообщение от сервера: ответ на наш запрос, уведомление или запрос к нам. */
  async handle(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Ответ на наш запрос
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? "ошибка сервера"));
      else p.resolve(msg.result);
      return;
    }

    // Запрос сервера к нам — обязательно отвечаем, иначе сервер может зависнуть
    if (msg.id !== undefined) {
      const handler = this.requestHandlers.get(msg.method);
      if (!handler) {
        void this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `не поддерживается: ${msg.method}` } });
        return;
      }
      try {
        const result = await handler(msg.params);
        void this.send({ jsonrpc: "2.0", id: msg.id, result: result ?? null });
      } catch (e) {
        void this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e) } });
      }
      return;
    }

    this.notificationHandlers.get(msg.method)?.(msg.params);
  }

  /** Сервер завершился: все ожидающие запросы отклоняем. */
  dispose() {
    this.alive = false;
    for (const p of this.pending.values()) p.reject(new Error(`${this.name} завершился`));
    this.pending.clear();
  }
}
