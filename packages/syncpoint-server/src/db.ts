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
    throw new Error("Drizzle migrations not found. Run `pnpm --filter syncpoint-server db:generate` first.");
  }
}

function hasTable(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  if (!hasTable(db, tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some(column => column.name === columnName);
}

function hasIndex(db: Database.Database, indexName: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName));
}


function runPeerContractNormalizationMigration(db: Database.Database): void {
  if (!hasColumn(db, "peer_contract", "participants")) return;

  const childTables = [
    "peer_contract_participant",
    "peer_contract_responsibility",
    "peer_contract_interface_spec",
    "peer_contract_resource_boundary",
    "peer_contract_dependency",
  ];
  const partiallyExistingChildTables = childTables.filter(tableName => hasTable(db, tableName));
  if (partiallyExistingChildTables.length > 0) {
    throw new Error(
      `peer_contract normalization encountered partial child tables: ${partiallyExistingChildTables.join(", ")}`,
    );
  }
  if (!fs.existsSync(PEER_CONTRACT_NORMALIZATION_SQL_PATH)) {
    throw new Error("Missing peer_contract normalization migration SQL.");
  }

  db.exec(fs.readFileSync(PEER_CONTRACT_NORMALIZATION_SQL_PATH, "utf-8"));
}


function runFkIndexesMigration(db: Database.Database): void {
  // Each index is created only if its target table exists.
  // This is safe on partial/legacy DBs that may not have all tables yet.
  const fkIndexes: Array<{ table: string; index: string; column: string }> = [
    { table: "resource_claim_resource", index: "idx_rcr_claim", column: "claim_id" },
    { table: "sync_gate_resource", index: "idx_sgr_gate", column: "gate_id" },
    { table: "sync_gate_related_claim", index: "idx_sgrc_gate", column: "gate_id" },
    { table: "operation_resource", index: "idx_opr_op", column: "operation_id" },
    { table: "write_permit_resource", index: "idx_wpr_permit", column: "permit_id" },
  ];
  for (const { table, index, column } of fkIndexes) {
    if (hasTable(db, table) && !hasIndex(db, index)) {
      db.exec(`CREATE INDEX \`${index}\` ON \`${table}\` (\`${column}\`);`);
    }
  }
}

function runAgentRegistryEntryMigration(db: Database.Database): void {
  if (!hasTable(db, "agent_registry_entry")) {
    if (!fs.existsSync(AGENT_REGISTRY_ENTRY_SQL_PATH)) {
      throw new Error("Missing agent_registry_entry migration SQL.");
    }

    db.exec(fs.readFileSync(AGENT_REGISTRY_ENTRY_SQL_PATH, "utf-8"));
    return;
  }

  if (!hasIndex(db, "uq_agent_registry_entry_agent")) {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS `uq_agent_registry_entry_agent` ON `agent_registry_entry` (`agent_id`);");
  }
}

function runQueryPathIndexesMigration(db: Database.Database): void {
  // Indexes for common query paths beyond FK indexes.
  // Each index is created only if its target table exists and the index doesn't already exist.
  const queryIndexes: Array<{ table: string; index: string; columns: string }> = [
    // resource_claim query paths
    { table: "resource_claim", index: "idx_claims_actor_status", columns: "actor_id, status" },
    { table: "resource_claim", index: "idx_claims_session", columns: "session_id" },
    { table: "resource_claim", index: "idx_claims_task", columns: "task_id" },
    // sync_gate query paths
    { table: "sync_gate", index: "idx_gates_status_created", columns: "status, created_at" },
    { table: "sync_gate", index: "idx_gates_task", columns: "task_id" },
    // checkpoint query paths
    { table: "checkpoint", index: "idx_checkpoints_task_created", columns: "task_id, created_at" },
    // checkpoint_review query paths
    { table: "checkpoint_review", index: "idx_reviews_task_created", columns: "task_id, created_at" },
    { table: "checkpoint_review", index: "idx_reviews_status", columns: "status" },
    { table: "checkpoint_review", index: "idx_reviews_req_agent", columns: "requesting_agent_id" },
    // event query paths
    { table: "event", index: "idx_events_entity", columns: "entity_type, entity_id" },
    { table: "event", index: "idx_events_type", columns: "event_type" },
    { table: "event", index: "idx_events_created", columns: "created_at" },
  ];
  for (const { table, index, columns } of queryIndexes) {
    if (hasTable(db, table) && !hasIndex(db, index)) {
      db.exec(`CREATE INDEX \`${index}\` ON \`${table}\` (${columns});`);
    }
  }
}

function runAgentMessageMigration(db: Database.Database): void {
  if (hasTable(db, "agent_message")) return;
  if (!fs.existsSync(AGENT_MESSAGE_SQL_PATH)) {
    throw new Error("Missing agent_message migration SQL.");
  }
  db.exec(fs.readFileSync(AGENT_MESSAGE_SQL_PATH, "utf-8"));
}

/**
 * Add sub-file scope columns (scope, function_name, line_start, line_end)
 * to all resource join tables. SQLite supports ALTER TABLE ADD COLUMN
 * for nullable columns, so this is a simple additive migration.
 */
function runStateTransitionLogMigration(db: Database.Database): void {
  if (hasTable(db, "state_transition_log")) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS state_transition_log (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      operation TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stlog_entity ON state_transition_log (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_stlog_agent ON state_transition_log (agent_id);
    CREATE INDEX IF NOT EXISTS idx_stlog_created ON state_transition_log (created_at);
  `);
}

function runResourceScopeMigration(db: Database.Database): void {
  const tables: Array<{ table: string; hasBaseHash: boolean }> = [
    { table: "resource_claim_resource", hasBaseHash: false },
    { table: "sync_gate_resource", hasBaseHash: false },

    { table: "operation_resource", hasBaseHash: false },
    { table: "write_permit_resource", hasBaseHash: true },
    { table: "context_snapshot_resource", hasBaseHash: false },
  ];
  for (const { table } of tables) {
    if (!hasTable(db, table)) continue;
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
    if (!columns.includes("scope")) {
      db.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`scope\` text NOT NULL DEFAULT 'file';`);
    }
    if (!columns.includes("function_name")) {
      db.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`function_name\` text;`);
    }
    if (!columns.includes("line_start")) {
      db.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`line_start\` integer;`);
    }
    if (!columns.includes("line_end")) {
      db.exec(`ALTER TABLE \`${table}\` ADD COLUMN \`line_end\` integer;`);
    }
  }
}

/**
 * Add incremental storage columns to context_snapshot table.
 */
function runContextSnapshotIncrementalMigration(db: Database.Database): void {
  if (!hasTable(db, "context_snapshot")) return;
  const columns = (db.prepare("PRAGMA table_info(context_snapshot)").all() as Array<{ name: string }>).map(c => c.name);
  if (!columns.includes("version")) {
    db.exec(`ALTER TABLE context_snapshot ADD COLUMN version integer NOT NULL DEFAULT 1;`);
  }
  if (!columns.includes("content_hash")) {
    db.exec(`ALTER TABLE context_snapshot ADD COLUMN content_hash text NOT NULL DEFAULT '';`);
  }
  if (!columns.includes("is_delta")) {
    db.exec(`ALTER TABLE context_snapshot ADD COLUMN is_delta integer NOT NULL DEFAULT 0;`);
  }
  if (!columns.includes("base_snapshot_id")) {
    db.exec(`ALTER TABLE context_snapshot ADD COLUMN base_snapshot_id text NOT NULL DEFAULT '';`);
  }
}

/**
 * Add seq column to event table for event persistence and replay.
 */
function runEventSeqMigration(db: Database.Database): void {
  if (!hasTable(db, "event")) return;
  const columns = (db.prepare("PRAGMA table_info(event)").all() as Array<{ name: string }>).map(c => c.name);
  if (!columns.includes("seq")) {
    db.exec(`ALTER TABLE event ADD COLUMN seq integer NOT NULL DEFAULT 0;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_seq ON event (seq);`);
  }
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
    sqlite.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
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
  runPeerContractNormalizationMigration(db);
  runAgentRegistryEntryMigration(db);
  runAgentMessageMigration(db);
  runFkIndexesMigration(db);
  runQueryPathIndexesMigration(db);
  runStateTransitionLogMigration(db);
  runResourceScopeMigration(db);
  runContextSnapshotIncrementalMigration(db);
  runEventSeqMigration(db);
  ensureRuntimeOnlyTables(db);
}
