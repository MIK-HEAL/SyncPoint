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

const PEER_CONTRACT_NORMALIZATION_SQL_PATH = path.join(
  DRIZZLE_MIGRATIONS_DIR,
  "0001_peer_contract_normalization.sql",
);

const AGENT_REGISTRY_ENTRY_SQL_PATH = path.join(
  DRIZZLE_MIGRATIONS_DIR,
  "0002_agent_registry_entry.sql",
);

function isColumnNullable(db: Database.Database, tableName: string, columnName: string): boolean {
  if (!hasTable(db, tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; notnull: number }>;
  const col = columns.find(c => c.name === columnName);
  return col ? col.notnull === 0 : false;
}

function ensureDrizzleMigrationAssets(): void {
  if (!fs.existsSync(DRIZZLE_MIGRATIONS_DIR) || !fs.existsSync(DRIZZLE_JOURNAL_PATH)) {
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

function runPeerContractNormalizationMigration(db: Database.Database): void {
  if (!hasColumn(db, "peer_contract", "participants")) return;

  const childTables = [
    "peer_contract_participant",
    "peer_contract_responsibility",
    "peer_contract_interface_spec",
    "peer_contract_file_boundary",
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

/**
 * Normalize JSON text columns from empty-string defaults to proper JSON values.
 * Drizzle mode:json auto-parses/stringifies, but legacy rows with "" will fail JSON.parse.
 * This migration converts:
 *   - sync_gate.policy_json: "" → default GatePolicy JSON
 *   - agent_manifest.escalation_preference_json: "{}" → full default EscalationPreference JSON
 *   - agent_registry_entry.manifest_json: "" → NULL (also drops NOT NULL)
 *   - operation.check_result: "" → NULL (also drops NOT NULL)
 *   - negotiation_session.config_json: "{}" → full default NegotiationConfig JSON
 */
function runJsonDefaultsMigration(db: Database.Database): void {
  // ── Value normalization (NOT NULL stays, just value changes) ──
  const valueMigrations: Array<{ table: string; column: string; from: string; to: string }> = [
    { table: "sync_gate", column: "policy_json", from: "", to: '{"kind":"all_required","timeoutAction":"escalate"}' },
    { table: "agent_manifest", column: "escalation_preference_json", from: "{}", to: '{"optIn":"when_available","priority":50,"maxConcurrentEscalations":3}' },
    { table: "negotiation_session", column: "config_json", from: "{}", to: '{"maxRounds":3,"roundDeadlineMinutes":15,"negotiationDeadlineMinutes":45}' },
  ];
  for (const { table, column, from, to } of valueMigrations) {
    if (!hasTable(db, table)) continue;
    db.exec(`UPDATE \`${table}\` SET \`${column}\` = '${to}' WHERE \`${column}\` = '${from}';`);
  }

  // ── Nullable column migrations (NOT NULL → nullable, "" → NULL) ──
  // SQLite doesn't support ALTER COLUMN; must recreate tables.
  // Foreign keys must be off during table recreation to avoid blocking DROP TABLE.

  // operation.check_result: TEXT DEFAULT '' NOT NULL → TEXT DEFAULT NULL
  if (hasTable(db, "operation") && !isColumnNullable(db, "operation", "check_result")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE \`_operation_new\` (
        \`id\` text PRIMARY KEY NOT NULL,
        \`type\` text NOT NULL,
        \`actor_id\` text NOT NULL,
        \`task_id\` text NOT NULL,
        \`session_id\` text DEFAULT '' NOT NULL,
        \`title\` text NOT NULL,
        \`summary\` text DEFAULT '' NOT NULL,
        \`payload_ref\` text DEFAULT '' NOT NULL,
        \`status\` text DEFAULT 'DRAFT' NOT NULL,
        \`check_result\` text DEFAULT NULL,
        \`decision_summary\` text DEFAULT '' NOT NULL,
        \`created_at\` text NOT NULL,
        \`updated_at\` text NOT NULL
      );
      INSERT INTO \`_operation_new\` SELECT
        \`id\`, \`type\`, \`actor_id\`, \`task_id\`, \`session_id\`, \`title\`, \`summary\`,
        \`payload_ref\`, \`status\`,
        CASE WHEN \`check_result\` = '' THEN NULL ELSE \`check_result\` END,
        \`decision_summary\`, \`created_at\`, \`updated_at\`
      FROM \`operation\`;
      DROP TABLE \`operation\`;
      ALTER TABLE \`_operation_new\` RENAME TO \`operation\`;
    `);
    db.pragma("foreign_keys = ON");
  }

  // agent_registry_entry.manifest_json: TEXT DEFAULT '' NOT NULL → TEXT DEFAULT NULL
  if (hasTable(db, "agent_registry_entry") && !isColumnNullable(db, "agent_registry_entry", "manifest_json")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE \`_agent_registry_entry_new\` (
        \`manifest_path\` text PRIMARY KEY NOT NULL,
        \`agent_id\` text,
        \`source_format\` text DEFAULT '' NOT NULL,
        \`content_hash\` text DEFAULT '' NOT NULL,
        \`manifest_json\` text DEFAULT NULL,
        \`status\` text DEFAULT 'pending' NOT NULL,
        \`error_message\` text DEFAULT '' NOT NULL,
        \`last_sync_at\` text NOT NULL,
        \`created_at\` text NOT NULL,
        \`updated_at\` text NOT NULL
      );
      INSERT INTO \`_agent_registry_entry_new\` SELECT
        \`manifest_path\`, \`agent_id\`, \`source_format\`, \`content_hash\`,
        CASE WHEN \`manifest_json\` = '' THEN NULL ELSE \`manifest_json\` END,
        \`status\`, \`error_message\`, \`last_sync_at\`, \`created_at\`, \`updated_at\`
      FROM \`agent_registry_entry\`;
      DROP TABLE \`agent_registry_entry\`;
      ALTER TABLE \`_agent_registry_entry_new\` RENAME TO \`agent_registry_entry\`;
      CREATE UNIQUE INDEX IF NOT EXISTS \`uq_agent_registry_entry_agent\` ON \`agent_registry_entry\` (\`agent_id\`);
    `);
    db.pragma("foreign_keys = ON");
  }
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
    { table: "file_claim", index: "idx_fc_agent", column: "agent_id" },
    { table: "file_claim", index: "idx_fc_task", column: "task_id" },
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

/**
 * Add sub-file scope columns (scope, function_name, line_start, line_end)
 * to all resource join tables. SQLite supports ALTER TABLE ADD COLUMN
 * for nullable columns, so this is a simple additive migration.
 */
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
  runPeerContractNormalizationMigration(db);
  runAgentRegistryEntryMigration(db);
  runFkIndexesMigration(db);
  runJsonDefaultsMigration(db);
  runResourceScopeMigration(db);
  ensureRuntimeOnlyTables(db);
}
