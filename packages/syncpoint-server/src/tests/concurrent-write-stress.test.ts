/**
 * Concurrent write stress test — Section 1.8.
 *
 * Verifies SQLite WAL mode handles 50+ rapid sequential/interleaved writes
 * without SQLITE_BUSY errors or data corruption.
 *
 * Note: better-sqlite3 is synchronous, so true concurrency is simulated
 * by rapid sequential writes within transactions. The test verifies that
 * WAL mode + busy_timeout allows interleaved transactions without errors.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getRawDb, isWalEnabled } from "../../src/db.js";
import { ensureApplicationBootstrap } from "../../src/application/index.js";

let tmpDir = "";

beforeEach(() => {
  closeDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-stress-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  ensureApplicationBootstrap();
  getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("concurrent write stress test", () => {
  it("handles 50 rapid sequential agent creations without errors", () => {
    const db = getRawDb();
    const CONCURRENT = 50;

    // Verify WAL is active
    const walMode = db.pragma("journal_mode", { simple: true });
    expect(walMode).toBe("wal");

    const ts = new Date().toISOString();
    const insertStmt = db.prepare(
      "INSERT INTO agent (id, name, provider, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    // Use a single transaction for batch insert to test WAL throughput
    const batchInsert = db.transaction(() => {
      for (let i = 0; i < CONCURRENT; i++) {
        insertStmt.run(`stress-agent-${i}`, `agent-${i}`, "cursor", "backend", "idle", ts, ts);
      }
    });

    // Should not throw SQLITE_BUSY
    expect(() => batchInsert()).not.toThrow();

    // Verify all 50 agents were created
    const count = db.prepare("SELECT COUNT(*) as cnt FROM agent WHERE name LIKE 'agent-%'").get() as { cnt: number };
    expect(count.cnt).toBe(CONCURRENT);
  });

  it("handles 50 interleaved transactions for resource claims", () => {
    const db = getRawDb();
    const ts = new Date().toISOString();

    // Pre-create agents and tasks
    const agentStmt = db.prepare("INSERT INTO agent (id, name, provider, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const taskStmt = db.prepare("INSERT INTO task (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");

    db.transaction(() => {
      agentStmt.run("stress-a1", "stress-agent", "cursor", "backend", "idle", ts, ts);
      taskStmt.run("stress-t1", "Stress task", "", "in_progress", ts, ts);
    })();

    const CONCURRENT = 50;
    const claimStmt = db.prepare(
      "INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    // Simulate interleaved writes: 50 separate transactions
    for (let i = 0; i < CONCURRENT; i++) {
      const insertClaim = db.transaction(() => {
        claimStmt.run(`stress-claim-${i}`, "stress-a1", "stress-t1", "stress-session", "file", "exclusive", "active", ts);
      });
      expect(() => insertClaim()).not.toThrow();
    }

    const count = db.prepare("SELECT COUNT(*) as cnt FROM resource_claim WHERE id LIKE 'stress-claim-%'").get() as { cnt: number };
    expect(count.cnt).toBe(CONCURRENT);
  });

  it("handles 50 rapid state transition log writes", () => {
    const db = getRawDb();
    const CONCURRENT = 50;
    const ts = new Date().toISOString();

    const logStmt = db.prepare(`
      INSERT INTO state_transition_log (id, entity_type, entity_id, from_state, to_state, operation, agent_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `);

    const batchInsert = db.transaction(() => {
      for (let i = 0; i < CONCURRENT; i++) {
        logStmt.run(
          `stress-log-${i}`,
          "resource_claim",
          `entity-${i}`,
          "none",
          "active",
          "claim",
          "agent-1",
          ts,
        );
      }
    });

    expect(() => batchInsert()).not.toThrow();

    const count = db.prepare("SELECT COUNT(*) as cnt FROM state_transition_log WHERE id LIKE 'stress-log-%'").get() as { cnt: number };
    expect(count.cnt).toBe(CONCURRENT);
  });

  it("reports WAL mode as enabled", () => {
    expect(isWalEnabled()).toBe(true);
  });
});
