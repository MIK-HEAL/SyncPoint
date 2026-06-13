/**
 * Database migration functions extracted from db.ts.
 *
 * Each function is idempotent — safe to call on an already-migrated database.
 * All functions are called by runMigrations() in db.ts.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { InternalError } from "syncpoint-kernel";
import * as schema from "./schema.js";

// ── Helpers ──────────────────────────────────────────

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

// ── Migration functions ──────────────────────────────

/**
 * Purpose: Normalizes the legacy `peer_contract` table by splitting its JSON
 * `participants` column into dedicated child tables (participant, responsibility,
 * interface_spec, resource_boundary, dependency).
 *
 * Idempotency: Skips if the `participants` column no longer exists.
 */
export function runPeerContractNormalizationMigration(
  db: Database.Database,
  sqlPath: string,
): void {
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
    throw new InternalError(
      `peer_contract normalization encountered partial child tables: ${partiallyExistingChildTables.join(", ")}`,
    );
  }
  if (!fs.existsSync(sqlPath)) {
    throw new InternalError("Missing peer_contract normalization migration SQL.");
  }

  db.exec(fs.readFileSync(sqlPath, "utf-8"));
}

/**
 * Purpose: Creates indexes on foreign key columns across join tables
 * (resource_claim_resource, sync_gate_resource, operation_resource,
 * write_permit_resource) to accelerate FK-based lookups.
 *
 * Idempotency: Checks for each index before creation.
 */
export function runFkIndexesMigration(db: Database.Database): void {
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

/**
 * Purpose: Creates the `agent_registry_entry` table from an external SQL file
 * and ensures its unique index on `agent_id` exists. Supports the agent
 * registration and discovery subsystem.
 *
 * Idempotency: Skips table creation if it already exists; adds index if missing.
 */
export function runAgentRegistryEntryMigration(
  db: Database.Database,
  sqlPath: string,
): void {
  if (!hasTable(db, "agent_registry_entry")) {
    if (!fs.existsSync(sqlPath)) {
      throw new InternalError("Missing agent_registry_entry migration SQL.");
    }
    db.exec(fs.readFileSync(sqlPath, "utf-8"));
    return;
  }

  if (!hasIndex(db, "uq_agent_registry_entry_agent")) {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS `uq_agent_registry_entry_agent` ON `agent_registry_entry` (`agent_id`);");
  }
}

/**
 * Purpose: Creates composite indexes on frequently queried columns across
 * core tables (resource_claim, sync_gate, checkpoint, checkpoint_review, event)
 * to accelerate common query paths: by actor+status, session, task, and time ranges.
 *
 * Idempotency: Checks for each index before creation.
 */
export function runQueryPathIndexesMigration(db: Database.Database): void {
  const queryIndexes: Array<{ table: string; index: string; columns: string }> = [
    { table: "resource_claim", index: "idx_claims_actor_status", columns: "actor_id, status" },
    { table: "resource_claim", index: "idx_claims_session", columns: "session_id" },
    { table: "resource_claim", index: "idx_claims_task", columns: "task_id" },
    { table: "sync_gate", index: "idx_gates_status_created", columns: "status, created_at" },
    { table: "sync_gate", index: "idx_gates_task", columns: "task_id" },
    { table: "checkpoint", index: "idx_checkpoints_task_created", columns: "task_id, created_at" },
    { table: "checkpoint_review", index: "idx_reviews_task_created", columns: "task_id, created_at" },
    { table: "checkpoint_review", index: "idx_reviews_status", columns: "status" },
    { table: "checkpoint_review", index: "idx_reviews_req_agent", columns: "requesting_agent_id" },
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

/**
 * Purpose: Creates the `agent_message` table from an external SQL file.
 * Stores inter-agent messages for the collaboration protocol.
 *
 * Idempotency: Skips if the table already exists.
 */
export function runAgentMessageMigration(
  db: Database.Database,
  sqlPath: string,
): void {
  if (hasTable(db, "agent_message")) return;
  if (!fs.existsSync(sqlPath)) {
    throw new InternalError("Missing agent_message migration SQL.");
  }
  db.exec(fs.readFileSync(sqlPath, "utf-8"));
}

/**
 * Purpose: Creates the `state_transition_log` table with indexes on entity,
 * agent, and timestamp columns. Provides an audit trail for all entity state
 * transitions in the system.
 *
 * Idempotency: Skips if the table already exists.
 */
export function runStateTransitionLogMigration(db: Database.Database): void {
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

/**
 * Purpose: Adds `scope`, `function_name`, `line_start`, and `line_end` columns
 * to all resource join tables. Enables fine-grained resource scoping beyond
 * file-level (e.g., function-level, line-range).
 *
 * Idempotency: Checks each column before adding; skips missing tables.
 */
export function runResourceScopeMigration(db: Database.Database): void {
  const tables: Array<{ table: string }> = [
    { table: "resource_claim_resource" },
    { table: "sync_gate_resource" },
    { table: "operation_resource" },
    { table: "write_permit_resource" },
    { table: "context_snapshot_resource" },
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
 * Purpose: Adds incremental snapshot support columns (`version`, `content_hash`,
 * `is_delta`, `base_snapshot_id`) to the `context_snapshot` table. Enables
 * delta-based snapshots that reference a base snapshot instead of storing full
 * copies every time.
 *
 * Idempotency: Checks each column before adding; skips if table is missing.
 */
export function runContextSnapshotIncrementalMigration(db: Database.Database): void {
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
 * Purpose: Adds a monotonically increasing `seq` column and index to the `event`
 * table. Enables ordered event replay and catch-up subscriptions by sequence number.
 *
 * Idempotency: Checks for column before adding; skips if table is missing.
 */
export function runEventSeqMigration(db: Database.Database): void {
  if (!hasTable(db, "event")) return;
  const columns = (db.prepare("PRAGMA table_info(event)").all() as Array<{ name: string }>).map(c => c.name);
  if (!columns.includes("seq")) {
    db.exec(`ALTER TABLE event ADD COLUMN seq integer NOT NULL DEFAULT 0;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_events_seq ON event (seq);`);
  }
}

/**
 * Purpose: Creates runtime-only tables that are not managed by Drizzle ORM
 * migrations: `memory_version` (optimistic concurrency control for project
 * memory) and the FTS5 full-text search index for project memory content.
 *
 * Idempotency: Uses CREATE IF NOT EXISTS and INSERT OR IGNORE.
 */
export function ensureRuntimeOnlyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_version (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO memory_version (id, version) VALUES (1, 0);
  `);

  db.exec(schema.PROJECT_MEMORY_FTS_SQL);
}
