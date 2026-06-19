/**
 * Database connection and Drizzle ORM setup for SyncPoint.
 *
 * Use `defaultContext` for the standard project database,
 * or `createDatabaseContext()` / `createTestDatabaseContext()` for custom setups.
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

// ── Path helpers ──────────────────────────────────────

const DRIZZLE_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

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

export function isProjectLocal(): boolean {
  if (process.env.SYNCPOINT_DB_DIR) return true;
  return findProjectSyncpointDir() !== null;
}

export function getSyncpointDir(): string {
  if (process.env.SYNCPOINT_DB_DIR) return process.env.SYNCPOINT_DB_DIR;
  const projectDir = findProjectSyncpointDir();
  if (projectDir) return projectDir;
  return path.join(os.homedir(), SYNCPOINT_DIR_NAME);
}

export function getDbPath(): string {
  if (process.env.SYNCPOINT_DB_DIR) {
    const dir = process.env.SYNCPOINT_DB_DIR;
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, DEFAULT_DB_NAME);
  }
  const projectDir = findProjectSyncpointDir();
  if (projectDir) {
    return path.join(projectDir, DEFAULT_DB_NAME);
  }
  const fallback = path.join(os.homedir(), SYNCPOINT_DIR_NAME);
  fs.mkdirSync(fallback, { recursive: true });
  return path.join(fallback, DEFAULT_DB_NAME);
}

function detectNetworkFilesystem(dbPath: string): boolean {
  const networkPrefixes = [
    "/mnt/", "/media/", "/Volumes/",
    "/net/", "/nfs/", "/smb/", "/cifs/",
  ];
  if (process.platform === "win32") {
    if (dbPath.startsWith("\\\\")) return true;
    const cloudSyncPatterns = [
      "OneDrive", "Dropbox", "Google Drive", "Box", "iCloudDrive",
    ];
    if (cloudSyncPatterns.some(p => dbPath.includes(p))) return true;
  }
  if (networkPrefixes.some(p => dbPath.startsWith(p))) return true;
  return false;
}

function ensureDrizzleMigrationAssets(): void {
  if (!fs.existsSync(DRIZZLE_MIGRATIONS_DIR)) {
    throw new InternalError(
      "Drizzle migrations not found. Run `pnpm --filter syncpoint-server db:generate` first.",
    );
  }
}

// ── DatabaseContext ───────────────────────────────────

export type SyncPointDb = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseContextOptions {
  dbPath?: string;
  skipWal?: boolean;
  /** Pre-existing Database handle. When set, no connection, pragmas,
   *  or migrations are applied — the caller owns the lifecycle. */
  sqlite?: Database.Database;
}

export class DatabaseContext {
  private _sqlite: Database.Database | null = null;
  private _db: SyncPointDb | null = null;
  private _walEnabled: boolean | null = null;
  private _dbPath: string;
  private _skipWal: boolean;
  private _externalSqlite: boolean;

  constructor(opts: DatabaseContextOptions = {}) {
    this._dbPath = opts.dbPath ?? getDbPath();
    this._skipWal = opts.skipWal ?? false;
    if (opts.sqlite) {
      this._sqlite = opts.sqlite;
      this._externalSqlite = true;
      // Build the drizzle wrapper immediately — caller manages lifecycle
      this._db = drizzle(this._sqlite, { schema });
    } else {
      this._externalSqlite = false;
    }
  }

  get db(): SyncPointDb {
    if (this._db) return this._db;
    this._sqlite = new Database(this._dbPath);
    this._applyPragmas();
    this._db = drizzle(this._sqlite, { schema });
    this._runMigrations();
    return this._db;
  }

  get raw(): Database.Database {
    this.db;
    return this._sqlite!;
  }

  get dbPath(): string {
    return this._dbPath;
  }

  get walEnabled(): boolean {
    return this._walEnabled === true;
  }

  destroy(): void {
    if (this._sqlite) {
      if (!this._externalSqlite) {
        this._sqlite.close();
      }
      this._sqlite = null;
      this._db = null;
      this._walEnabled = null;
    }
  }

  checkIntegrity(): { ok: boolean; details: string } {
    if (!this._sqlite) {
      return { ok: false, details: "Database not initialized" };
    }
    try {
      const result = this._sqlite.pragma("integrity_check", { simple: true });
      const ok = result === "ok";
      return { ok, details: ok ? "ok" : String(result) };
    } catch (err) {
      return {
        ok: false,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  backup(destPath: string): { ok: boolean; error?: string } {
    if (!this._sqlite) {
      return { ok: false, error: "Database not initialized" };
    }
    try {
      const resolved = path.resolve(destPath);
      const destDir = path.dirname(resolved);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      this._sqlite.exec(`VACUUM INTO '${resolved.replace(/'/g, "''")}'`);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getWalSize(): number | null {
    if (!this._sqlite || !this._walEnabled) return null;
    try {
      const walPath = this._dbPath + "-wal";
      const stat = fs.statSync(walPath);
      return stat.size;
    } catch {
      return null;
    }
  }

  private _applyPragmas(): void {
    const db = this._sqlite!;
    db.pragma("foreign_keys = ON");

    if (this._skipWal || detectNetworkFilesystem(this._dbPath)) {
      this._walEnabled = false;
      return;
    }

    try {
      db.pragma("journal_mode = WAL");
      const currentMode = db.pragma("journal_mode", { simple: true });
      if (currentMode === "wal") {
        this._walEnabled = true;
        db.pragma("synchronous = NORMAL");
        db.pragma("wal_autocheckpoint = 1000");
        db.pragma("busy_timeout = 5000");
        db.pragma("mmap_size = 268435456");
        db.pragma("temp_store = MEMORY");
        db.pragma("cache_size = -64000");
      } else {
        this._walEnabled = false;
      }
    } catch {
      this._walEnabled = false;
    }
  }

  private _runMigrations(): void {
    const db = this._sqlite!;
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
}

// ── Factory functions ─────────────────────────────────

export function createDatabaseContext(opts?: DatabaseContextOptions): DatabaseContext {
  return new DatabaseContext(opts);
}

export function createTestDatabaseContext(): DatabaseContext {
  return new DatabaseContext({ dbPath: ":memory:", skipWal: true });
}

/** Default project database context. Created lazily on first access. */
export const defaultContext = new DatabaseContext();

// ── Utilities ─────────────────────────────────────────

export function initSyncpointDir(baseDir: string = process.cwd()): string {
  const dir = path.join(path.resolve(baseDir), SYNCPOINT_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, DEFAULT_DB_NAME);
  const ctx = new DatabaseContext({ dbPath });
  ctx.db;
  ctx.destroy();
  return dir;
}

/** Run migrations on a raw Database handle (for tests that bypass DatabaseContext). */
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
