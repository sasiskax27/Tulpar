// 🐳 Простая панель Docker: контейнеры, образы, логи, compose.
import { core } from "../ipc";

export interface Container { ID: string; Names: string; Image: string; Status: string; State: string; Ports: string }
export interface Image { ID: string; Repository: string; Tag: string; Size: string; CreatedSince: string }
export interface Stat { Name: string; CPUPerc: string; MemUsage: string }

async function run(cmd: string, timeout = 30) {
  const r = await core.agentRun(cmd, timeout);
  return { ok: r.code === 0, out: r.output };
}

const lines = <T,>(out: string): T[] =>
  out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("{")).map((l) => {
    try {
      return JSON.parse(l) as T;
    } catch {
      return null;
    }
  }).filter((x): x is T => x !== null);

export async function dockerStatus(): Promise<"ok" | "missing" | "stopped"> {
  const v = await run("docker version --format \"{{.Server.Version}}\"", 15);
  if (v.ok) return "ok";
  return /not recognized|not found|не является|не найден|No such file/i.test(v.out) ? "missing" : "stopped";
}

export const containers = async () => lines<Container>((await run('docker ps -a --format "{{json .}}"')).out);
export const images = async () => lines<Image>((await run('docker images --format "{{json .}}"')).out);
export const stats = async () => lines<Stat>((await run('docker stats --no-stream --format "{{json .}}"', 30)).out);
export const logs = async (id: string) => (await run(`docker logs --tail 300 ${id}`, 30)).out;
export const action = async (verb: "start" | "stop" | "restart" | "rm" | "rmi", id: string) => run(`docker ${verb} ${id}`, 120);
export const compose = async (verb: "up -d" | "down" | "restart" | "pull") => run(`docker compose ${verb}`, 600);
