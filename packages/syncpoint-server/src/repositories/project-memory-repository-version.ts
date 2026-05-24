import { sql } from "drizzle-orm";
import { _getDb } from "./_shared.js";

export function getMemoryVersion(): number {
  const db = _getDb();
  const row = db.get<{ version: number }>(sql`SELECT version FROM memory_version WHERE id = 1`);
  return row?.version ?? 0;
}

export function bumpMemoryVersion(): number {
  const db = _getDb();
  db.run(sql`UPDATE memory_version SET version = version + 1 WHERE id = 1`);
  return getMemoryVersion();
}
