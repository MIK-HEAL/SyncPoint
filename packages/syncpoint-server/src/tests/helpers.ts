/**
 * Test helpers for SyncPoint server tests.
 *
 * Provides:
 * - Temporary SQLite database (in-memory or temp file)
 * - Random port allocation
 * - Test cleanup
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import net from "node:net";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema";

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS agent (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    provider        TEXT NOT NULL,
    role            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'IDLE',
    current_task_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS task (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'OPEN',
    owner_agent_id  TEXT REFERENCES agent(id),
    parent_task_id  TEXT REFERENCES task(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS checkpoint (
    id                   TEXT PRIMARY KEY,
    task_id              TEXT NOT NULL REFERENCES task(id),
    agent_id             TEXT NOT NULL REFERENCES agent(id),
    summary              TEXT NOT NULL,
    progress             TEXT NOT NULL DEFAULT '',
    current_understanding TEXT NOT NULL DEFAULT '',
    changed_files        TEXT NOT NULL DEFAULT '',
    risks                TEXT NOT NULL DEFAULT '',
    blockers             TEXT NOT NULL DEFAULT '',
    next_steps           TEXT NOT NULL DEFAULT '',
    need_sync            INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS diary_entry (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agent(id),
    task_id     TEXT NOT NULL REFERENCES task(id),
    entry_type  TEXT NOT NULL DEFAULT 'NOTE',
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS handoff (
    id               TEXT PRIMARY KEY,
    from_agent_id    TEXT NOT NULL REFERENCES agent(id),
    to_agent_id      TEXT NOT NULL REFERENCES agent(id),
    task_id          TEXT NOT NULL REFERENCES task(id),
    context_summary  TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'PENDING',
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS peer_contract (
    id               TEXT PRIMARY KEY,
    task_id          TEXT NOT NULL REFERENCES task(id),
    title            TEXT NOT NULL DEFAULT '',
    participants     TEXT NOT NULL DEFAULT '',
    scope            TEXT NOT NULL DEFAULT '',
    responsibilities TEXT NOT NULL DEFAULT '',
    interface_spec   TEXT NOT NULL DEFAULT '',
    file_boundaries  TEXT NOT NULL DEFAULT '',
    dependencies     TEXT NOT NULL DEFAULT '',
    test_plan        TEXT NOT NULL DEFAULT '',
    risks            TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'DRAFT',
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS context_capsule (
    id                   TEXT PRIMARY KEY,
    task_id              TEXT NOT NULL REFERENCES task(id),
    agent_id             TEXT NOT NULL REFERENCES agent(id),
    checkpoint_id        TEXT NOT NULL REFERENCES checkpoint(id),
    goal                 TEXT NOT NULL DEFAULT '',
    current_phase        TEXT NOT NULL DEFAULT '',
    confirmed_decisions  TEXT NOT NULL DEFAULT '',
    interface_contract   TEXT NOT NULL DEFAULT '',
    working_files        TEXT NOT NULL DEFAULT '',
    completed_work       TEXT NOT NULL DEFAULT '',
    remaining_work       TEXT NOT NULL DEFAULT '',
    risks                TEXT NOT NULL DEFAULT '',
    blockers             TEXT NOT NULL DEFAULT '',
    next_steps           TEXT NOT NULL DEFAULT '',
    resume_prompt        TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS event (
    id           TEXT PRIMARY KEY,
    event_type   TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pinned_memory (
    id          TEXT PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    content     TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'project',
    task_id     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function runMigrations(db: Database.Database): void {
  db.exec(MIGRATION_SQL);
}

// ── Temporary database ──────────────────────────────────

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  path: string;
  close: () => void;
}

/**
 * Create a temporary in-memory SQLite database with migrations applied.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    path: ":memory:",
    close: () => sqlite.close(),
  };
}

/**
 * Create a temporary file-based SQLite database.
 * The file is deleted on close().
 */
export function createTempFileDb(): TestDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoint-test-"));
  const dbPath = path.join(dir, "test.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    path: dbPath,
    close: () => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── Random port ─────────────────────────────────────────

/**
 * Get a random available port.
 */
export async function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr !== null) {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to get port")));
      }
    });
    server.on("error", reject);
  });
}

// ── tRPC test client helper ─────────────────────────────

export async function trpcFetch(
  baseUrl: string,
  procedure: string,
  input?: unknown,
  method: "GET" | "POST" = input !== undefined ? "POST" : "GET",
): Promise<unknown> {
  const url =
    method === "GET" && input !== undefined
      ? `${baseUrl}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${baseUrl}/trpc/${procedure}`;
  const opts: RequestInit =
    method === "POST"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      : {};
  const r = await fetch(url, opts);
  const json = (await r.json()) as { result?: { data: unknown }; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result?.data;
}
