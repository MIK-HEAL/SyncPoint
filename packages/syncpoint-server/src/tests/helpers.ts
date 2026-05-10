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
import { runMigrations as runCurrentMigrations } from "../db";

function runMigrations(db: Database.Database): void {
  runCurrentMigrations(db);
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
  callerId?: string,
): Promise<unknown> {
  const url =
    method === "GET" && input !== undefined
      ? `${baseUrl}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `${baseUrl}/trpc/${procedure}`;
  const headers: Record<string, string> = {};
  if (method === "POST") headers["Content-Type"] = "application/json";
  if (callerId) headers["x-caller-id"] = callerId;
  const opts: RequestInit =
    method === "POST"
      ? { method: "POST", headers, body: JSON.stringify(input) }
      : { headers };
  const r = await fetch(url, opts);
  const text = await r.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${r.status}): ${text.slice(0, 200)}`);
  }
  if (json.error) {
    // tRPC standalone adapter wraps errors: { error: { json: { message } } }
    const msg = json.error?.json?.message ?? json.error?.message ?? JSON.stringify(json.error);
    throw new Error(msg);
  }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  return json.result?.data;
}
