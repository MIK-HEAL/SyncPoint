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
import { InternalError } from "syncpoint-kernel";
import * as schema from "./schema.js";
import {
  runPeerContractNormalizationMigration,
  runAgentRegistryEntryMigration,
  runAgentMessageMigration,
  runFkIndexesMigration,
  runQueryPathIndexesMigration,
  runStateTransitionLogMigration,
  runResourceScopeMigration,
  runContextSnapshotIncrementalMigration,
  runEventSeqMigration,
  ensureRuntimeOnlyTables,
} from "./db-migrations.js";

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

const PEER_CONTRACT_NORMALIZATION_SQL_PATH = path.join(
  DRIZZLE_MIGRATIONS_DIR,
  "0001_peer_contract_normalization.sql",
);

const AGENT_REGISTRY_ENTRY_SQL_PATH = path.join(
  DRIZZLE_MIGRATIONS_DIR,
  "0002_agent_registry_entry.sql",
);

const AGENT_MESSAGE_SQL_PATH = path.join(
  DRIZZLE_MIGRATIONS_DIR,
  "0004_agent_message.sql",
);


function ensureDrizzleMigrationAssets(): void {
  if (!fs.existsSync(DRIZZLE_MIGRATIONS_DIR)) {
    throw new InternalError("Drizzle migrations not found. Run `pnpm --filter syncpoint-server db:generate` first.");
  }
}

// Migration functions extracted to db-migrations.ts

function detectNetworkFilesystem(dbPath: string): boolean {
  // Common network/synced filesystem mount points and path patterns
  const networkPrefixes = [
    "/mnt/", "/media/", "/Volumes/",
    "/net/", "/nfs/", "/smb/", "/cifs/",
  ];
  // Windows UNC paths and network drives
  if (process.platform === "win32") {
    if (dbPath.startsWith("\\\\")) return true;
    // Common cloud-sync directories on Windows
    const cloudSyncPatterns = [
      "OneDrive", "Dropbox", "Google Drive", "Box", "iCloudDrive",
    ];
    if (cloudSyncPatterns.some(p => dbPath.includes(p))) return true;
  }
  if (networkPrefixes.some(p => dbPath.startsWith(p))) return true;
  return false;
}

let _walEnabled: boolean | null = null;

/**
 * Returns true if WAL mode was successfully enabled on the current database.
 */
export function isWalEnabled(): boolean {
  return _walEnabled === true;
}

function applyPragmas(db: Database.Database, dbPath: string): void {
  db.pragma("foreign_keys = ON");

  // Skip WAL on known network/synced filesystems to avoid disk I/O errors
  if (detectNetworkFilesystem(dbPath)) {
    _walEnabled = false;
    return;
  }

  // Attempt to enable WAL mode. On some filesystems (network drives,
  // certain Linux kernel configs) this can fail with disk I/O errors.
  // Gracefully fall back to DELETE journal mode if WAL fails.
  try {
    db.pragma("journal_mode = WAL");
    const currentMode = db.pragma("journal_mode", { simple: true });
    if (currentMode === "wal") {
      _walEnabled = true;
      // WAL mode is safe with NORMAL synchronous (fsync only at checkpoint)
      db.pragma("synchronous = NORMAL");
      // Auto-checkpoint every 1000 pages (~4MB) to keep WAL file manageable
      db.pragma("wal_autocheckpoint = 1000");
      // Wait up to 5s on lock contention instead of immediately failing
      db.pragma("busy_timeout = 5000");
      // Use memory-mapped I/O for better read performance
      db.pragma("mmap_size = 268435456"); // 256MB
      // Store temp tables in memory
      db.pragma("temp_store = MEMORY");
      // Increase page cache for better performance
      db.pragma("cache_size = -64000"); // 64MB
    } else {
      _walEnabled = false;
    }
  } catch {
    // WAL failed — fall back to DELETE mode silently
    _walEnabled = false;
  }
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
  applyPragmas(db, dbPath);
  runMigrations(db);
  db.close();
  return dir;
}

export type SyncPointDb = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(): SyncPointDb {
  if (_db) return _db;
  const dbPath = getDbPath();
  sqlite = new Database(dbPath);
  applyPragmas(sqlite, dbPath);
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
    _walEnabled = null;
  }
}

/**
 * Run a database integrity check. Returns true if the database passes.
 */
export function checkDbIntegrity(): { ok: boolean; details: string } {
  if (!sqlite) {
    return { ok: false, details: "Database not initialized" };
  }
  try {
    const result = sqlite.pragma("integrity_check", { simple: true });
    const ok = result === "ok";
    return { ok, details: ok ? "ok" : String(result) };
  } catch (err) {
    return { ok: false, details: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Create a backup of the current database to the specified path.
 * Uses VACUUM INTO for a clean, defragmented copy (SQLite 3.27.0+).
 */
export function backupDb(destPath: string): { ok: boolean; error?: string } {
  if (!sqlite) {
    return { ok: false, error: "Database not initialized" };
  }
  try {
    // Resolve and validate the destination path before passing to SQLite.
    // VACUUM INTO does not support bound parameters, so we resolve to a
    // canonical absolute path and still escape single-quote literals.
    const resolved = path.resolve(destPath);
    const destDir = path.dirname(resolved);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    sqlite.exec(`VACUUM INTO '${resolved.replace(/'/g, "''")}'`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Return the current WAL file size in bytes, or null if WAL is not enabled.
 */
export function getWalSize(): number | null {
  if (!sqlite || !_walEnabled) return null;
  try {
    const dbPath = getDbPath();
    const walPath = dbPath + "-wal";
    const stat = fs.statSync(walPath);
    return stat.size;
  } catch {
    return null;
  }
}

export function runMigrations(db: Database.Database): void {
  ensureDrizzleMigrationAssets();
  migrate(drizzle(db, { schema }), { migrationsFolder: DRIZZLE_MIGRATIONS_DIR });
  runPeerContractNormalizationMigration(db, PEER_CONTRACT_NORMALIZATION_SQL_PATH);
  runAgentRegistryEntryMigration(db, AGENT_REGISTRY_ENTRY_SQL_PATH);
  runAgentMessageMigration(db, AGENT_MESSAGE_SQL_PATH);
  runFkIndexesMigration(db);
  runQueryPathIndexesMigration(db);
  runStateTransitionLogMigration(db);
  runResourceScopeMigration(db);
  runContextSnapshotIncrementalMigration(db);
  runEventSeqMigration(db);
  ensureRuntimeOnlyTables(db);
}
