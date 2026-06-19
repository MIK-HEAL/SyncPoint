/**
 * EXPLAIN QUERY PLAN verification test — Section 5.6.
 *
 * Verifies that all high-frequency queries use the expected indexes
 * rather than full table scans.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {  } from "../../src/db.js";
import { ensureApplicationBootstrap } from "../../src/application/index.js";

let tmpDir = "";

beforeEach(() => {
  defaultContext.destroy();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-explain-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  ensureApplicationBootstrap();
  defaultContext.db;
});

afterEach(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

interface ExplainRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

function explainQuery(sql: string): ExplainRow[] {
  const db = defaultContext.raw;
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as ExplainRow[];
}

function usesIndex(rows: ExplainRow[], indexName: string): boolean {
  return rows.some(r => r.detail.includes("INDEX") && r.detail.includes(indexName));
}

function usesCoveringIndex(rows: ExplainRow[], indexName: string): boolean {
  return rows.some(r => r.detail.includes("COVERING INDEX") && r.detail.includes(indexName));
}

function isFullScan(rows: ExplainRow[]): boolean {
  return rows.some(r => r.detail.includes("SCAN") && !r.detail.includes("INDEX"));
}

describe("EXPLAIN QUERY PLAN verification", () => {
  it("resource_claim by actor_id + status uses idx_claims_actor_status", () => {
    const plan = explainQuery(
      "SELECT * FROM resource_claim WHERE actor_id = 'a1' AND status = 'ACTIVE'"
    );
    expect(usesIndex(plan, "idx_claims_actor_status") || usesCoveringIndex(plan, "idx_claims_actor_status")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("resource_claim by session_id uses idx_claims_session", () => {
    const plan = explainQuery(
      "SELECT * FROM resource_claim WHERE session_id = 's1'"
    );
    expect(usesIndex(plan, "idx_claims_session") || usesCoveringIndex(plan, "idx_claims_session")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("resource_claim by task_id uses idx_claims_task", () => {
    const plan = explainQuery(
      "SELECT * FROM resource_claim WHERE task_id = 't1'"
    );
    expect(usesIndex(plan, "idx_claims_task") || usesCoveringIndex(plan, "idx_claims_task")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("sync_gate by status + created_at uses idx_gates_status_created", () => {
    const plan = explainQuery(
      "SELECT * FROM sync_gate WHERE status = 'NEEDS_SYNC' ORDER BY created_at DESC"
    );
    expect(usesIndex(plan, "idx_gates_status_created") || usesCoveringIndex(plan, "idx_gates_status_created")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("sync_gate by task_id uses idx_gates_task", () => {
    const plan = explainQuery(
      "SELECT * FROM sync_gate WHERE task_id = 't1'"
    );
    expect(usesIndex(plan, "idx_gates_task") || usesCoveringIndex(plan, "idx_gates_task")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("checkpoint by task_id + created_at uses idx_checkpoints_task_created", () => {
    const plan = explainQuery(
      "SELECT * FROM checkpoint WHERE task_id = 't1' ORDER BY created_at DESC"
    );
    expect(usesIndex(plan, "idx_checkpoints_task_created") || usesCoveringIndex(plan, "idx_checkpoints_task_created")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("event by entity_type + entity_id uses idx_events_entity", () => {
    const plan = explainQuery(
      "SELECT * FROM event WHERE entity_type = 'resource_claim' AND entity_id = 'e1'"
    );
    expect(usesIndex(plan, "idx_events_entity") || usesCoveringIndex(plan, "idx_events_entity")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("event by event_type uses idx_events_type", () => {
    const plan = explainQuery(
      "SELECT * FROM event WHERE event_type = 'CLAIM_CREATED'"
    );
    expect(usesIndex(plan, "idx_events_type") || usesCoveringIndex(plan, "idx_events_type")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("event by created_at uses idx_events_created", () => {
    const plan = explainQuery(
      "SELECT * FROM event ORDER BY created_at DESC LIMIT 100"
    );
    expect(usesIndex(plan, "idx_events_created") || usesCoveringIndex(plan, "idx_events_created")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("checkpoint_review by task_id + created_at uses idx_reviews_task_created", () => {
    const plan = explainQuery(
      "SELECT * FROM checkpoint_review WHERE task_id = 't1' ORDER BY created_at DESC"
    );
    expect(usesIndex(plan, "idx_reviews_task_created") || usesCoveringIndex(plan, "idx_reviews_task_created")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });

  it("checkpoint_review by status uses idx_reviews_status", () => {
    const plan = explainQuery(
      "SELECT * FROM checkpoint_review WHERE status = 'pending'"
    );
    expect(usesIndex(plan, "idx_reviews_status") || usesCoveringIndex(plan, "idx_reviews_status")).toBe(true);
    expect(isFullScan(plan)).toBe(false);
  });
});
