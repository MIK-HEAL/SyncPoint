/**
 * DB schema test: sync gate votes are unique per (gate_id, agent_id).
 */

import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "../../src/db.js";

describe("DB vote uniqueness", () => {
  let tmpDir: string;
  const origEnv = process.env.SYNCPOINT_DB_DIR;

  afterAll(() => {
    defaultContext.destroy();
    if (origEnv !== undefined) {
      process.env.SYNCPOINT_DB_DIR = origEnv;
    } else {
      delete process.env.SYNCPOINT_DB_DIR;
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fresh schema prevents duplicate votes for the same gate and agent", () => {
    defaultContext.destroy();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-vote-migrate-"));
    process.env.SYNCPOINT_DB_DIR = tmpDir;
    defaultContext.db;

    const db = defaultContext.raw;

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sync_gate_vote'").all() as any[];
    const indexNames = indexes.map((r: any) => r.name);
    expect(indexNames).toContain("uq_gate_vote_agent");

    db.prepare(
      "INSERT INTO sync_gate (id, task_id, requested_by_agent_id, status, created_at, updated_at) VALUES ('g1', 't1', 'a1', 'NEEDS_SYNC', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z')"
    ).run();
    db.prepare(
      "INSERT INTO sync_gate (id, task_id, requested_by_agent_id, status, created_at, updated_at) VALUES ('g2', 't1', 'a1', 'NEEDS_SYNC', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z')"
    ).run();

    db.prepare(
      "INSERT INTO sync_gate_vote (id, gate_id, agent_id, vote, summary, created_at) VALUES ('v1', 'g1', 'a1', 'approve', '', '2024-02-01T00:00:00Z')"
    ).run();
    db.prepare(
      "INSERT INTO sync_gate_vote (id, gate_id, agent_id, vote, summary, created_at) VALUES ('v2', 'g1', 'a2', 'reject', '', '2024-02-01T00:00:00Z')"
    ).run();
    db.prepare(
      "INSERT INTO sync_gate_vote (id, gate_id, agent_id, vote, summary, created_at) VALUES ('v3', 'g2', 'a1', 'abstain', '', '2024-02-01T00:00:00Z')"
    ).run();

    expect(() => {
      db.prepare(
        "INSERT INTO sync_gate_vote (id, gate_id, agent_id, vote, summary, created_at) VALUES ('dup', 'g1', 'a1', 'reject', '', '2024-02-01T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });
});
