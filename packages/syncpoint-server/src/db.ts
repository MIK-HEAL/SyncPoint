/**
 * Database connection and Drizzle ORM setup for SyncPoint.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

export const SYNCPOINT_DIR_NAME = ".syncpoint";
const DEFAULT_DB_NAME = "syncpoint.db";

/**
 * Walk up from cwd looking for an existing .syncpoint/ directory.
 * Returns the first match, or null if none found.
 */
export function findProjectSyncpointDir(from: string = process.cwd()): string | null {
  let dir = path.resolve(from);
  const { root } = path.parse(dir);
  const fallbackDir = path.resolve(os.homedir(), SYNCPOINT_DIR_NAME);
  while (true) {
    const candidate = path.join(dir, SYNCPOINT_DIR_NAME);
    if (
      path.resolve(candidate) !== fallbackDir &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isDirectory()
    ) {
      return candidate;
    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

let sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
const DRIZZLE_MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
const DRIZZLE_JOURNAL_PATH = path.join(DRIZZLE_MIGRATIONS_DIR, "meta", "_journal.json");

type DrizzleJournalEntry = {
  when: number;
  tag: string;
};

type DrizzleMigrationJournal = {
  entries?: DrizzleJournalEntry[];
};

function ensureDrizzleMigrationAssets(): void {
  if (!fs.existsSync(DRIZZLE_MIGRATIONS_DIR) || !fs.existsSync(DRIZZLE_JOURNAL_PATH)) {
    throw new Error("Drizzle migrations not found. Run `pnpm --filter syncpoint-server db:generate` first.");
  }
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function hasLegacySchema(db: Database.Database): boolean {
  return hasTable(db, "agent") || hasTable(db, "task") || hasTable(db, "project_memory");
}

function getMigrationRowCount(db: Database.Database): number {
  if (!hasTable(db, "__drizzle_migrations")) return 0;
  const row = db.prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations").get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function readDrizzleBaselineEntry(): DrizzleJournalEntry | null {
  const journal = JSON.parse(fs.readFileSync(DRIZZLE_JOURNAL_PATH, "utf-8")) as DrizzleMigrationJournal;
  return journal.entries?.[0] ?? null;
}

function bootstrapLegacyDrizzleJournal(db: Database.Database): void {
  if (!hasLegacySchema(db)) return;
  if (getMigrationRowCount(db) > 0) return;

  const baseline = readDrizzleBaselineEntry();
  if (!baseline) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);

  db.prepare("INSERT INTO \"__drizzle_migrations\" (\"hash\", \"created_at\") VALUES (?, ?)").run(baseline.tag, baseline.when);
}

function ensureRuntimeOnlyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_version (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO memory_version (id, version) VALUES (1, 0);
  `);

  db.exec(schema.PROJECT_MEMORY_FTS_SQL);
}

function applyPragmas(db: Database.Database): void {
  // Keep the default journal mode for v0.1 first-run reliability.
  // Some local/synced filesystems reject WAL with disk I/O errors and leave
  // the current connection unable to write afterward.
  db.pragma("foreign_keys = ON");
}

/**
 * Returns true if the DB resolves to a project-local .syncpoint/ (not ~/.syncpoint fallback).
 */
export function isProjectLocal(): boolean {
  if (process.env.SYNCPOINT_DB_DIR) return true;
  return findProjectSyncpointDir() !== null;
}

/**
 * Returns the resolved .syncpoint directory path (project-local or fallback).
 */
export function getSyncpointDir(): string {
  if (process.env.SYNCPOINT_DB_DIR) return process.env.SYNCPOINT_DB_DIR;
  const projectDir = findProjectSyncpointDir();
  if (projectDir) return projectDir;
  return path.join(os.homedir(), SYNCPOINT_DIR_NAME);
}

export function getDbPath(): string {
  // 1. Explicit env var wins
  if (process.env.SYNCPOINT_DB_DIR) {
    const dir = process.env.SYNCPOINT_DB_DIR;
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, DEFAULT_DB_NAME);
  }
  // 2. Walk up to find project-local .syncpoint/
  const projectDir = findProjectSyncpointDir();
  if (projectDir) {
    return path.join(projectDir, DEFAULT_DB_NAME);
  }
  // 3. Fallback to ~/.syncpoint/
  const fallback = path.join(os.homedir(), SYNCPOINT_DIR_NAME);
  fs.mkdirSync(fallback, { recursive: true });
  return path.join(fallback, DEFAULT_DB_NAME);
}

/**
 * Initialize a .syncpoint/ directory in the given (or current) directory.
 * Returns the created directory path.
 */
export function initSyncpointDir(baseDir: string = process.cwd()): string {
  const dir = path.join(path.resolve(baseDir), SYNCPOINT_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  // Create the DB to ensure schema exists
  const dbPath = path.join(dir, DEFAULT_DB_NAME);
  const db = new Database(dbPath);
  applyPragmas(db);
  runMigrations(db);
  db.close();
  return dir;
}

export type SyncPointDb = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(): SyncPointDb {
  if (_db) return _db;
  sqlite = new Database(getDbPath());
  applyPragmas(sqlite);
  _db = drizzle(sqlite, { schema });
  runMigrations(sqlite);
  return _db;
}

export function getRawDb(): Database.Database {
  getDb();
  return sqlite!;
}

export function closeDb(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    _db = null;
  }
}

export function runMigrations(db: Database.Database): void {
  ensureDrizzleMigrationAssets();
  bootstrapLegacyDrizzleJournal(db);
  migrate(drizzle(db, { schema }), { migrationsFolder: DRIZZLE_MIGRATIONS_DIR });
  ensureRuntimeOnlyTables(db);
}
