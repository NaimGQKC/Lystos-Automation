import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(schemaPath, "utf8"));
  return db;
}

export function logEvent(db: DB, type: string, agentId: string | null, payload: unknown): void {
  db.prepare("INSERT INTO events (type, agent_id, payload) VALUES (?, ?, ?)").run(
    type,
    agentId,
    JSON.stringify(payload ?? null),
  );
}
