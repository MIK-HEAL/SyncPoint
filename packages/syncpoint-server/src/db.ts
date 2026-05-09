/**
 * Database connection and Drizzle ORM setup for SyncPoint.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      provider        TEXT NOT NULL,
      role            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'IDLE',
      current_task_id TEXT,
      runtime_id      TEXT,
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
      intent_scope         TEXT NOT NULL DEFAULT '',
      non_goals            TEXT NOT NULL DEFAULT '',
      verified_facts       TEXT NOT NULL DEFAULT '',
      unverified_claims    TEXT NOT NULL DEFAULT '',
      evidence_refs        TEXT NOT NULL DEFAULT '',
      active_constraints   TEXT NOT NULL DEFAULT '',
      do_not_touch         TEXT NOT NULL DEFAULT '',
      handoff_instructions TEXT NOT NULL DEFAULT '',
      validation_status    TEXT NOT NULL DEFAULT '',
      stale_reason         TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS project_memory (
      id                    TEXT PRIMARY KEY,
      scope                 TEXT NOT NULL DEFAULT 'project',
      category              TEXT NOT NULL,
      title                 TEXT NOT NULL,
      content               TEXT NOT NULL,
      tags                  TEXT NOT NULL DEFAULT '',
      source_type           TEXT NOT NULL DEFAULT 'human',
      source_ref            TEXT NOT NULL DEFAULT '',
      status                TEXT NOT NULL DEFAULT 'draft',
      confidence            TEXT NOT NULL DEFAULT 'medium',
      task_id               TEXT,
      fingerprint           TEXT NOT NULL DEFAULT '',
      supersedes            TEXT,
      superseded_by         TEXT,
      kind                  TEXT NOT NULL DEFAULT 'fact',
      projection_target     TEXT,
      applies_to            TEXT NOT NULL DEFAULT '',
      severity              TEXT NOT NULL DEFAULT 'info',
      validity_status       TEXT NOT NULL DEFAULT 'fresh',
      validity_stale_reason TEXT NOT NULL DEFAULT '',
      validator_type        TEXT NOT NULL DEFAULT '',
      validator_config      TEXT NOT NULL DEFAULT '',
      created_by            TEXT NOT NULL DEFAULT '',
      updated_by            TEXT NOT NULL DEFAULT '',
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pinned_memory (
      id          TEXT PRIMARY KEY,
      key         TEXT NOT NULL UNIQUE,
      content     TEXT NOT NULL,
      scope       TEXT NOT NULL DEFAULT 'project',
      task_id     TEXT REFERENCES task(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orchestration_session (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'PLANNING',
      relationship_mode   TEXT NOT NULL DEFAULT 'manager-delegate',
      architect_id        TEXT,
      created_by          TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_profile (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES orchestration_session(id),
      agent_id      TEXT NOT NULL REFERENCES agent(id),
      role          TEXT NOT NULL,
      capabilities  TEXT NOT NULL DEFAULT '',
      assigned_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_assignment (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES orchestration_session(id),
      task_id           TEXT NOT NULL REFERENCES task(id),
      assignee_agent_id TEXT NOT NULL REFERENCES agent(id),
      assigned_by       TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'PROPOSED',
      notes             TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_request (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES orchestration_session(id),
      task_id           TEXT NOT NULL REFERENCES task(id),
      reviewer_agent_id TEXT NOT NULL REFERENCES agent(id),
      requested_by      TEXT NOT NULL DEFAULT '',
      scope             TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'PENDING',
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_decision (
      id                 TEXT PRIMARY KEY,
      review_request_id  TEXT NOT NULL REFERENCES review_request(id),
      verdict            TEXT NOT NULL,
      summary            TEXT NOT NULL,
      requested_changes  TEXT NOT NULL DEFAULT '',
      decided_by         TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_checklist_item (
      id                 TEXT PRIMARY KEY,
      review_request_id  TEXT NOT NULL REFERENCES review_request(id),
      title              TEXT NOT NULL,
      description        TEXT NOT NULL DEFAULT '',
      required           INTEGER NOT NULL DEFAULT 1,
      status             TEXT NOT NULL DEFAULT 'OPEN',
      notes              TEXT NOT NULL DEFAULT '',
      updated_by         TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_evidence (
      id                 TEXT PRIMARY KEY,
      review_request_id  TEXT NOT NULL REFERENCES review_request(id),
      kind               TEXT NOT NULL,
      title              TEXT NOT NULL,
      content            TEXT NOT NULL,
      metadata_json      TEXT NOT NULL DEFAULT '',
      created_by         TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS change_request (
      id                 TEXT PRIMARY KEY,
      review_request_id  TEXT NOT NULL REFERENCES review_request(id),
      summary            TEXT NOT NULL,
      items              TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'OPEN',
      evidence_id        TEXT,
      requested_by       TEXT NOT NULL DEFAULT '',
      addressed_by       TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS approval_record (
      id                 TEXT PRIMARY KEY,
      review_request_id  TEXT NOT NULL REFERENCES review_request(id),
      decision           TEXT NOT NULL,
      summary            TEXT NOT NULL,
      requested_changes  TEXT NOT NULL DEFAULT '',
      waiver_reason      TEXT NOT NULL DEFAULT '',
      decided_by         TEXT NOT NULL DEFAULT '',
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wake_request (
      id                  TEXT PRIMARY KEY,
      session_id          TEXT NOT NULL REFERENCES orchestration_session(id),
      target_agent_id     TEXT NOT NULL REFERENCES agent(id),
      target_role         TEXT NOT NULL,
      action              TEXT NOT NULL,
      reason              TEXT NOT NULL,
      trigger_event_type  TEXT NOT NULL,
      trigger_entity_id   TEXT NOT NULL,
      task_id             TEXT,
      review_request_id   TEXT,
      prompt_hint         TEXT NOT NULL DEFAULT '',
      mcp_tool_hint       TEXT NOT NULL DEFAULT '',
      cli_hint            TEXT NOT NULL DEFAULT '',
      runner_mode         TEXT NOT NULL DEFAULT 'manual',
      status              TEXT NOT NULL DEFAULT 'QUEUED',
      result_summary      TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS resource_claim (
      id              TEXT PRIMARY KEY,
      actor_id        TEXT NOT NULL,
      task_id         TEXT NOT NULL,
      session_id      TEXT NOT NULL DEFAULT '',
      resource_type   TEXT NOT NULL,
      resources_json  TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'exclusive',
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      released_at     TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS file_claim (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL REFERENCES agent(id),
      task_id     TEXT NOT NULL REFERENCES task(id),
      session_id  TEXT NOT NULL DEFAULT '',
      paths       TEXT NOT NULL,
      mode        TEXT NOT NULL DEFAULT 'exclusive',
      status      TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      released_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS operation (
      id                      TEXT PRIMARY KEY,
      type                    TEXT NOT NULL,
      actor_id                TEXT NOT NULL,
      task_id                 TEXT NOT NULL,
      session_id              TEXT NOT NULL DEFAULT '',
      title                   TEXT NOT NULL,
      summary                 TEXT NOT NULL DEFAULT '',
      target_resources_json   TEXT NOT NULL DEFAULT '[]',
      payload_ref             TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'DRAFT',
      check_result            TEXT NOT NULL DEFAULT '',
      decision_summary        TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patch_proposal (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL,
      task_id                 TEXT NOT NULL,
      agent_id                TEXT NOT NULL,
      title                   TEXT NOT NULL,
      summary                 TEXT NOT NULL DEFAULT '',
      patch_text              TEXT NOT NULL,
      touched_files           TEXT NOT NULL DEFAULT '',
      related_claim_ids       TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'DRAFT',
      check_result            TEXT NOT NULL DEFAULT '',
      decision_summary        TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_transaction (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL,
      task_id                 TEXT NOT NULL,
      checkpoint_id           TEXT NOT NULL,
      requesting_agent_id     TEXT NOT NULL,
      required_approver_ids   TEXT NOT NULL,
      approved_by_ids         TEXT NOT NULL DEFAULT '',
      rejected_by_ids         TEXT NOT NULL DEFAULT '',
      gate_id                 TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'OPEN',
      decision_summary        TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_gate (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL DEFAULT '',
      task_id                 TEXT NOT NULL,
      requested_by_agent_id   TEXT NOT NULL,
      required_agent_ids      TEXT NOT NULL,
      acked_agent_ids         TEXT NOT NULL DEFAULT '',
      reason                  TEXT NOT NULL DEFAULT 'manual_request',
      description             TEXT NOT NULL DEFAULT '',
      related_files           TEXT NOT NULL DEFAULT '',
      related_resources_json  TEXT NOT NULL DEFAULT '',
      related_checkpoint_id   TEXT NOT NULL DEFAULT '',
      related_claim_ids       TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'NEEDS_SYNC',
      decision_summary        TEXT NOT NULL DEFAULT '',
      policy_json             TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runtime (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'local-mcp',
      provider        TEXT NOT NULL DEFAULT '',
      host            TEXT NOT NULL DEFAULT '',
      workspace_root  TEXT NOT NULL DEFAULT '',
      agent_id        TEXT,
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      last_seen_at    TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Additive migrations (safe to re-run) ──
  const addColumn = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  };
  // P11 runtime identity
  addColumn("agent", "runtime_id", "TEXT");
  // Relationship-mode release migration
  addColumn("orchestration_session", "relationship_mode", "TEXT NOT NULL DEFAULT 'manager-delegate'");
  // P12 extended capsule fields
  addColumn("context_capsule", "intent_scope", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "non_goals", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "verified_facts", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "unverified_claims", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "evidence_refs", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "active_constraints", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "do_not_touch", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "handoff_instructions", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "validation_status", "TEXT NOT NULL DEFAULT ''");
  addColumn("context_capsule", "stale_reason", "TEXT NOT NULL DEFAULT ''");
  // P1 project memory governance
  addColumn("project_memory", "fingerprint", "TEXT NOT NULL DEFAULT ''");
  addColumn("project_memory", "supersedes", "TEXT");
  addColumn("project_memory", "superseded_by", "TEXT");
  // P2 project memory V2 schema
  addColumn("project_memory", "kind", "TEXT NOT NULL DEFAULT 'fact'");
  addColumn("project_memory", "projection_target", "TEXT");
  addColumn("project_memory", "applies_to", "TEXT NOT NULL DEFAULT ''");
  addColumn("project_memory", "severity", "TEXT NOT NULL DEFAULT 'info'");
  addColumn("project_memory", "validity_status", "TEXT NOT NULL DEFAULT 'fresh'");
  addColumn("project_memory", "validity_stale_reason", "TEXT NOT NULL DEFAULT ''");
  // PR4 typed constraint validator
  addColumn("project_memory", "validator_type", "TEXT NOT NULL DEFAULT ''");
  addColumn("project_memory", "validator_config", "TEXT NOT NULL DEFAULT ''");
  // Plugin architecture: generic resource_claim + operation + sync_gate forward compat
  addColumn("sync_gate", "related_resources_json", "TEXT NOT NULL DEFAULT ''");
  // SyncGate liveness policy
  addColumn("sync_gate", "policy_json", "TEXT NOT NULL DEFAULT ''");
  // SyncGate vote table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_gate_vote (
      id          TEXT PRIMARY KEY,
      gate_id     TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      vote        TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Unique constraint: one vote per agent per gate (last vote wins via upsert in repo)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_vote_agent ON sync_gate_vote(gate_id, agent_id);`);
  // Memory version counter — single row table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_version (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO memory_version (id, version) VALUES (1, 0);
  `);
}
