// Реестр команд. Каждое действие в Tulpar — команда с id.
// Поэтому любое действие можно вызвать из палитры, повесить на клавишу,
// а позже — вызвать из скрипта пользователя или расширения.
import { notifyError } from "../app/notify";

export interface Command {
  id: string;
  title: string;
  category?: string;
  run: (args?: unknown) => unknown | Promise<unknown>;
}

const commands = new Map<string, Command>();

export function registerCommand(cmd: Command): () => void {
  if (commands.has(cmd.id)) console.warn(`Команда ${cmd.id} перерегистрирована`);
  commands.set(cmd.id, cmd);
  return () => commands.delete(cmd.id);
}

export async function executeCommand(id: string, args?: unknown): Promise<unknown> {
  const cmd = commands.get(id);
  if (!cmd) {
    notifyError("Команда не найдена", id);
    return;
  }
  try {
    return await cmd.run(args);
  } catch (e) {
    notifyError(cmd.title, e);
  }
}

export function allCommands(): Command[] {
  return [...commands.values()].sort((a, b) => label(a).localeCompare(label(b)));
}

export function label(cmd: Command): string {
  return cmd.category ? `${cmd.category}: ${cmd.title}` : cmd.title;
}
