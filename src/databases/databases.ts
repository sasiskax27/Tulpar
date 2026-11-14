// Подключения к серверным базам: хранение, проверка, вспомогательное.
import { settings, updateSetting } from "../config/store";

export type DbKind = "postgres" | "mysql" | "mongodb";
export interface DbConnection {
  id: string;
  name: string;
  kind: DbKind;
  url: string;
}

export const KINDS: { id: DbKind; label: string; template: string; hint: string }[] = [
  { id: "postgres", label: "PostgreSQL", template: "postgres://user:password@localhost:5432/dbname", hint: "Supabase, Neon, Railway — строка подключения из их панели" },
  { id: "mysql", label: "MySQL / MariaDB", template: "mysql://root:password@localhost:3306/dbname", hint: "Укажите имя базы в конце адреса" },
  { id: "mongodb", label: "MongoDB", template: "mongodb://localhost:27017", hint: "MongoDB Atlas: mongodb+srv://user:password@cluster…" },
];

export function connections(): DbConnection[] {
  return (settings()["tulpar.databases"] ?? []) as DbConnection[];
}

export function connectionById(id: string): DbConnection | undefined {
  return connections().find((c) => c.id === id);
}

export function saveConnection(c: DbConnection) {
  const list = connections().filter((x) => x.id !== c.id);
  updateSetting("tulpar.databases", [...list, c]);
}

export function removeConnection(id: string) {
  updateSetting("tulpar.databases", connections().filter((c) => c.id !== id));
}

export function guessKind(url: string): DbKind | null {
  if (/^postgres(ql)?:\/\//i.test(url)) return "postgres";
  if (/^(mysql|mariadb):\/\//i.test(url)) return "mysql";
  if (/^mongodb(\+srv)?:\/\//i.test(url)) return "mongodb";
  return null;
}

/** Адрес без пароля — для подсказок и заголовков. */
export function safeUrl(url: string): string {
  return url.replace(/(\/\/[^:/@]+):[^@]*@/, "$1:•••@");
}

export function quoteIdent(kind: DbKind, name: string): string {
  return kind === "mysql" ? "`" + name.replace(/`/g, "``") + "`" : `"${name.replace(/"/g, '""')}"`;
}

/** Изменяющий запрос? Для защиты от случайного DELETE/DROP. */
export function isWriteSql(sql: string): boolean {
  const s = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "").trim().toUpperCase();
  return /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|RENAME|MERGE|UPSERT)\b/.test(s) || /;\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(s);
}
