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
  // ── Breaking Schema Reset (v0.2) ──
  // No backward compatibility. No additive migrations. Delete local DB to rebuild.
  db.exec(`
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
      id                    TEXT PRIMARY KEY,
      task_id               TEXT NOT NULL REFERENCES task(id),
      agent_id              TEXT NOT NULL REFERENCES agent(id),
      summary               TEXT NOT NULL,
      progress              TEXT NOT NULL DEFAULT '',
      current_understanding TEXT NOT NULL DEFAULT '',
      changed_files         TEXT NOT NULL DEFAULT '',
      risks                 TEXT NOT NULL DEFAULT '',
      blockers              TEXT NOT NULL DEFAULT '',
      next_steps            TEXT NOT NULL DEFAULT '',
      need_sync             INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
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

    -- Context Snapshot (replaces context_capsule wide table)
    CREATE TABLE IF NOT EXISTS context_snapshot (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL REFERENCES task(id),
      agent_id        TEXT NOT NULL REFERENCES agent(id),
      checkpoint_id   TEXT NOT NULL REFERENCES checkpoint(id),
      kind            TEXT NOT NULL DEFAULT 'checkpoint',
      summary         TEXT NOT NULL DEFAULT '',
      payload_json    TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS context_snapshot_resource (
      id              TEXT PRIMARY KEY,
      snapshot_id     TEXT NOT NULL REFERENCES context_snapshot(id),
      resource_type   TEXT NOT NULL,
      locator         TEXT NOT NULL,
      metadata        TEXT NOT NULL DEFAULT ''
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

    -- Resource Claim (normalized — no resourcesJson)
    CREATE TABLE IF NOT EXISTS resource_claim (
      id              TEXT PRIMARY KEY,
      actor_id        TEXT NOT NULL,
      task_id         TEXT NOT NULL,
      session_id      TEXT NOT NULL DEFAULT '',
      resource_type   TEXT NOT NULL,
      mode            TEXT NOT NULL DEFAULT 'exclusive',
      status          TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      released_at     TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS resource_claim_resource (
      id              TEXT PRIMARY KEY,
      claim_id        TEXT NOT NULL REFERENCES resource_claim(id),
      resource_type   TEXT NOT NULL,
      locator         TEXT NOT NULL,
      metadata        TEXT NOT NULL DEFAULT ''
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

    -- SyncGate (normalized — no CSV fields)
    CREATE TABLE IF NOT EXISTS sync_gate (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL DEFAULT '',
      task_id                 TEXT NOT NULL,
      requested_by_agent_id   TEXT NOT NULL,
      reason                  TEXT NOT NULL DEFAULT 'manual_request',
      description             TEXT NOT NULL DEFAULT '',
      related_checkpoint_id   TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'NEEDS_SYNC',
      decision_summary        TEXT NOT NULL DEFAULT '',
      policy_json             TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_gate_required_agent (
      id          TEXT PRIMARY KEY,
      gate_id     TEXT NOT NULL REFERENCES sync_gate(id),
      agent_id    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_req_agent ON sync_gate_required_agent(gate_id, agent_id);

    CREATE TABLE IF NOT EXISTS sync_gate_resource (
      id              TEXT PRIMARY KEY,
      gate_id         TEXT NOT NULL REFERENCES sync_gate(id),
      resource_type   TEXT NOT NULL,
      locator         TEXT NOT NULL,
      metadata        TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sync_gate_related_claim (
      id          TEXT PRIMARY KEY,
      gate_id     TEXT NOT NULL REFERENCES sync_gate(id),
      claim_id    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_gate_vote (
      id          TEXT PRIMARY KEY,
      gate_id     TEXT NOT NULL REFERENCES sync_gate(id),
      agent_id    TEXT NOT NULL,
      vote        TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_vote_agent ON sync_gate_vote(gate_id, agent_id);

    -- Checkpoint Review (replaces sync_transaction — no CSV fields)
    CREATE TABLE IF NOT EXISTS checkpoint_review (
      id                      TEXT PRIMARY KEY,
      session_id              TEXT NOT NULL,
      task_id                 TEXT NOT NULL,
      checkpoint_id           TEXT NOT NULL,
      requesting_agent_id     TEXT NOT NULL,
      gate_id                 TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'OPEN',
      decision_summary        TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checkpoint_review_approver (
      id          TEXT PRIMARY KEY,
      review_id   TEXT NOT NULL REFERENCES checkpoint_review(id),
      agent_id    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'required',
      decided_at  TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_review_approver ON checkpoint_review_approver(review_id, agent_id);

    -- Operation (normalized — no targetResourcesJson)
    CREATE TABLE IF NOT EXISTS operation (
      id                      TEXT PRIMARY KEY,
      type                    TEXT NOT NULL,
      actor_id                TEXT NOT NULL,
      task_id                 TEXT NOT NULL,
      session_id              TEXT NOT NULL DEFAULT '',
      title                   TEXT NOT NULL,
      summary                 TEXT NOT NULL DEFAULT '',
      payload_ref             TEXT NOT NULL DEFAULT '',
      status                  TEXT NOT NULL DEFAULT 'DRAFT',
      check_result            TEXT NOT NULL DEFAULT '',
      decision_summary        TEXT NOT NULL DEFAULT '',
      created_at              TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operation_resource (
      id              TEXT PRIMARY KEY,
      operation_id    TEXT NOT NULL REFERENCES operation(id),
      resource_type   TEXT NOT NULL,
      locator         TEXT NOT NULL,
      metadata        TEXT NOT NULL DEFAULT ''
    );

    -- Write Permit (normalized — no resourcesJson/baseHashesJson)
    CREATE TABLE IF NOT EXISTS write_permit (
      id              TEXT PRIMARY KEY,
      actor_id        TEXT NOT NULL,
      task_id         TEXT NOT NULL,
      session_id      TEXT NOT NULL DEFAULT '',
      intent          TEXT NOT NULL,
      operation_id    TEXT NOT NULL DEFAULT '',
      guarded_root    TEXT NOT NULL DEFAULT '',
      expires_at      TEXT NOT NULL,
      single_use      INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL,
      decision_json   TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at     TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS write_permit_resource (
      id              TEXT PRIMARY KEY,
      permit_id       TEXT NOT NULL REFERENCES write_permit(id),
      resource_type   TEXT NOT NULL,
      locator         TEXT NOT NULL,
      base_hash       TEXT NOT NULL DEFAULT '',
      metadata        TEXT NOT NULL DEFAULT ''
    );

    -- Agent Manifest
    CREATE TABLE IF NOT EXISTS agent_manifest (
      agent_id                    TEXT PRIMARY KEY,
      capabilities_json           TEXT NOT NULL DEFAULT '[]',
      escalation_preference_json  TEXT NOT NULL DEFAULT '{}',
      availability                TEXT NOT NULL DEFAULT 'online',
      can_handle_human_escalation INTEGER NOT NULL DEFAULT 0,
      tags_json                   TEXT NOT NULL DEFAULT '[]',
      created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Negotiation Session (normalized — no participantIds CSV)
    CREATE TABLE IF NOT EXISTS negotiation_session (
      id                   TEXT PRIMARY KEY,
      gate_id              TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'OPEN',
      current_round        INTEGER NOT NULL DEFAULT 0,
      config_json          TEXT NOT NULL DEFAULT '{}',
      round_started_at     TEXT,
      deadline_at          TEXT,
      resolved_by_agent_id TEXT,
      resolution_summary   TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS negotiation_participant (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL REFERENCES negotiation_session(id),
      agent_id    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_participant ON negotiation_participant(session_id, agent_id);

    CREATE TABLE IF NOT EXISTS negotiation_message (
      id          TEXT PRIMARY KEY,
      session_id  TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      round       INTEGER NOT NULL DEFAULT 0,
      kind        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Memory version counter
    CREATE TABLE IF NOT EXISTS memory_version (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO memory_version (id, version) VALUES (1, 0);
  `);

  // FTS5 full-text search for project memory
  db.exec(schema.PROJECT_MEMORY_FTS_SQL);
}
