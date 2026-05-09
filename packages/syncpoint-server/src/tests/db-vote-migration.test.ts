/**
 * Migration test: legacy duplicate votes are deduped before unique index creation.
 *
 * Simulates an old database that has multiple votes per (gate_id, agent_id),
 * then runs the migration (via getDb) and verifies:
 *   1. Only the latest vote per (gate_id, agent_id) survives.
 *   2. The unique index exists and prevents future duplicates at the DB level.
 */

import { describe, it, expect, afterAll } from "vitest";
import Database from "better-sqlite3";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb, getRawDb } from "../../src/db.js";

describe("DB vote dedup migration", () => {
  let tmpDir: string;
  const origEnv = process.env.SYNCPOINT_DB_DIR;

  afterAll(() => {
    closeDb();
    if (origEnv !== undefined) {
      process.env.SYNCPOINT_DB_DIR = origEnv;
    } else {
      delete process.env.SYNCPOINT_DB_DIR;
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("old DB with duplicate votes upgrades successfully", () => {
    // Ensure no existing connection
    closeDb();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-vote-migrate-"));
    const dbPath = path.join(tmpDir, "syncpoint.db");

    // Step 1: Create a pre-migration database with the old schema (no unique index)
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE IF NOT EXISTS sync_gate_vote (
        id          TEXT PRIMARY KEY,
        gate_id     TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        vote        TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Insert duplicate votes: same (gate_id, agent_id), different votes
    raw.exec(`
      INSERT INTO sync_gate_vote (id, gate_id, agent_id, vote, summary, created_at)
      VALUES
        ('v1', 'g1', 'a1', 'approve', 'first', '2024-01-01T00:00:00Z'),
        ('v2', 'g1', 'a1', 'reject',  'second', '2024-01-02T00:00:00Z'),
        ('v3', 'g1', 'a1', 'abstain', 'third', '2024-01-03T00:00:00Z'),
        ('v4', 'g1', 'a2', 'approve', 'only one', '2024-01-01T00:00:00Z'),
        ('v5', 'g2', 'a1', 'reject',  'different gate', '2024-01-01T00:00:00Z');
    `);

    // Verify duplicates exist
    const beforeCount = raw.prepare("SELECT COUNT(*) as cnt FROM sync_gate_vote WHERE gate_id='g1' AND agent_id='a1'").get() as any;
    expect(beforeCount.cnt).toBe(3);

    raw.close();

    // Step 2: Point getDb to our pre-seeded DB and let it run migrations
    process.env.SYNCPOINT_DB_DIR = tmpDir;
    getDb(); // triggers runMigrations → dedup + CREATE UNIQUE INDEX

    // Step 3: Use raw DB handle to verify
    const db = getRawDb();

    // Only 1 row per (gate_id, agent_id) for g1/a1
    const rows = db.prepare("SELECT * FROM sync_gate_vote WHERE gate_id='g1' AND agent_id='a1'").all() as any[];
    expect(rows.length).toBe(1);
    // The survivor should be the last inserted (highest rowid = v3, vote=abstain)
    expect(rows[0].vote).toBe("abstain");

    // g1/a2 should still have its single row
    const a2Rows = db.prepare("SELECT * FROM sync_gate_vote WHERE gate_id='g1' AND agent_id='a2'").all() as any[];
    expect(a2Rows.length).toBe(1);
    expect(a2Rows[0].vote).toBe("approve");

    // g2/a1 should still exist
    const g2Rows = db.prepare("SELECT * FROM sync_gate_vote WHERE gate_id='g2' AND agent_id='a1'").all() as any[];
    expect(g2Rows.length).toBe(1);

    // Step 4: Verify unique index exists
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sync_gate_vote'").all() as any[];
    const indexNames = indexes.map((r: any) => r.name);
    expect(indexNames).toContain("uq_gate_vote_agent");

    // Step 5: Verify the unique index prevents direct duplicate inserts
    expect(() => {
      db.prepare(
        "INSERT INTO sync_gate_vote (id, gate_id, agent_id, vote, summary, created_at) VALUES ('dup', 'g1', 'a1', 'reject', '', '2024-02-01T00:00:00Z')"
      ).run();
    }).toThrow(/UNIQUE constraint failed/);
  });
});
