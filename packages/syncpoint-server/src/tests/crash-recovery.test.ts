/**
 * Crash recovery unit tests — Section 4.5.
 *
 * Verifies:
 *   - state_transition_log records transitions
 *   - findIntermediateStateEntities detects stuck entities
 *   - getEntityTransitionHistory returns correct records
 *   - Compensation definitions are complete for critical operations
 *   - Force recovery via CLI logic works correctly
 *   - Simulated mid-transaction crash recovery
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getRawDb } from "../../src/db.js";
import { ensureApplicationBootstrap } from "../../src/application/index.js";
import {
  executeAtomicTransition,
  getEntityTransitionHistory,
  findIntermediateStateEntities,
  getCompensationDefinition,
  listCompensationDefinitions,
  getRecoveryState,
  registerCompensation,
  unregisterCompensation,
  clearCompensationRegistry,
  StateTransitionError,
} from "../../src/application/state-transition-service.js";
import type { StateTransitionRecord, CompensationDefinition } from "../../src/application/state-transition-service.js";
import { insertTransitionLog } from "../../src/repositories/state-transition-repository.js";

let tmpDir = "";

beforeEach(() => {
  closeDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-crash-recovery-"));
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

describe("state_transition_log", () => {
  it("records atomic transitions", () => {
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-1",
      fromState: "none",
      toState: "active",
      operation: "claim",
      agentId: "agent-1",
    };

    executeAtomicTransition(record, () => {
      // Simulate the state update
      const db = getRawDb();
      db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("claim-1", "agent-1", "task-1", "session-1", "file", "exclusive", "active", new Date().toISOString());
    });

    const history = getEntityTransitionHistory("resource_claim", "claim-1");
    expect(history).toHaveLength(1);
    expect(history[0].operation).toBe("claim");
    expect(history[0].fromState).toBe("none");
    expect(history[0].toState).toBe("active");
    expect(history[0].createdAt).toBeTruthy();
  });

  it("rolls back transition and log on failure", () => {
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-fail",
      fromState: "none",
      toState: "active",
      operation: "claim",
      agentId: "agent-1",
    };

    expect(() => {
      executeAtomicTransition(record, () => {
        throw new Error("Simulated crash");
      });
    }).toThrow("Simulated crash");

    // No transition should be logged
    const history = getEntityTransitionHistory("resource_claim", "claim-fail");
    expect(history).toHaveLength(0);
  });
});

describe("findIntermediateStateEntities", () => {
  it("finds entities stuck in non-terminal states", () => {
    // Create a claim and transition it to "active" (not terminal)
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-stuck",
      fromState: "none",
      toState: "active",
      operation: "claim",
      agentId: "agent-1",
    };

    executeAtomicTransition(record, () => {
      const db = getRawDb();
      db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("claim-stuck", "agent-1", "task-1", "session-1", "file", "exclusive", "active", new Date().toISOString());
    });

    const stuck = findIntermediateStateEntities("resource_claim", ["released", "expired", "revoked"]);
    expect(stuck.length).toBeGreaterThanOrEqual(1);
    expect(stuck.some(s => s.entityId === "claim-stuck")).toBe(true);
  });

  it("does not report entities in terminal states", () => {
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-done",
      fromState: "active",
      toState: "released",
      operation: "release",
      agentId: "agent-1",
    };

    executeAtomicTransition(record, () => {
      const db = getRawDb();
      db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("claim-done", "agent-1", "task-1", "session-1", "file", "exclusive", "released", new Date().toISOString());
    });

    const stuck = findIntermediateStateEntities("resource_claim", ["released", "expired", "revoked"]);
    expect(stuck.some(s => s.entityId === "claim-done")).toBe(false);
  });
});

describe("compensation definitions", () => {
  it("covers all critical entity types", () => {
    const criticalTypes = ["resource_claim", "sync_gate", "operation", "write_permit", "checkpoint_review"];
    for (const type of criticalTypes) {
      const defs = listCompensationDefinitions(type);
      expect(defs.length).toBeGreaterThan(0);
    }
  });

  it("provides compensation for claim operation", () => {
    const comp = getCompensationDefinition("resource_claim", "claim");
    expect(comp).toBeDefined();
    expect(comp!.compensateOperation).toBe("release");
    expect(comp!.compensateToState).toBe("released");
  });

  it("provides compensation for approve operation", () => {
    const comp = getCompensationDefinition("operation", "approve");
    expect(comp).toBeDefined();
    expect(comp!.compensateToState).toBe("rejected");
  });

  it("returns undefined for unknown operations", () => {
    const comp = getCompensationDefinition("nonexistent_entity", "unknown_op");
    expect(comp).toBeUndefined();
  });

  it("getRecoveryState returns compensation target state", () => {
    expect(getRecoveryState("resource_claim", "claim")).toBe("released");
    expect(getRecoveryState("sync_gate", "request")).toBe("cancelled");
    expect(getRecoveryState("operation", "submit")).toBe("cancelled");
  });

  it("getRecoveryState returns undefined for unknown operations", () => {
    expect(getRecoveryState("resource_claim", "nonexistent")).toBeUndefined();
  });

  it("listCompensationDefinitions returns all without filter", () => {
    const all = listCompensationDefinitions();
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  it("supports extensible registration", () => {
    // Register a custom compensation
    registerCompensation({
      entityType: "custom_entity",
      operation: "deploy",
      compensateOperation: "rollback",
      compensateToState: "rolled_back",
      description: "Custom deploy compensation",
    });

    const comp = getCompensationDefinition("custom_entity", "deploy");
    expect(comp).toBeDefined();
    expect(comp!.compensateToState).toBe("rolled_back");

    // Cleanup
    unregisterCompensation("custom_entity", "deploy");
    expect(getCompensationDefinition("custom_entity", "deploy")).toBeUndefined();
  });
});

describe("simulated crash recovery", () => {
  it("recovers stuck claim by forcing to released state", () => {
    // Create a claim that appears stuck in "active" state
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-crash",
      fromState: "none",
      toState: "active",
      operation: "claim",
      agentId: "agent-1",
    };

    executeAtomicTransition(record, () => {
      const db = getRawDb();
      db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("claim-crash", "agent-1", "task-1", "session-1", "file", "exclusive", "active", new Date().toISOString());
    });

    // Simulate crash recovery: detect stuck entity
    const stuck = findIntermediateStateEntities("resource_claim", ["released", "expired", "revoked"]);
    const crashed = stuck.find(s => s.entityId === "claim-crash");
    expect(crashed).toBeDefined();

    // Determine recovery state from compensation
    const recoveryState = getRecoveryState("resource_claim", "claim");
    expect(recoveryState).toBe("released");

    // Force recover (ensure recovery log has a later timestamp)
    const db = getRawDb();
    db.prepare("UPDATE resource_claim SET status = ? WHERE id = ?").run("released", "claim-crash");
    const recoveryTs = new Date(Date.now() + 1).toISOString();
    insertTransitionLog({
      entityType: "resource_claim",
      entityId: "claim-crash",
      fromState: "recovery",
      toState: "released",
      operation: "force_recover",
      agentId: "system",
      createdAt: recoveryTs,
    });

    // Verify entity is now in terminal state
    const postRecovery = findIntermediateStateEntities("resource_claim", ["released", "expired", "revoked"]);
    expect(postRecovery.some(s => s.entityId === "claim-crash")).toBe(false);

    // Verify recovery was logged
    const history = getEntityTransitionHistory("resource_claim", "claim-crash");
    expect(history).toHaveLength(2);
    expect(history[0].operation).toBe("force_recover");
    expect(history[0].toState).toBe("released");
  });

  it("recovers stuck operation by forcing to cancelled state", () => {
    const record: StateTransitionRecord = {
      entityType: "operation",
      entityId: "op-crash",
      fromState: "draft",
      toState: "submitted",
      operation: "submit",
      agentId: "agent-1",
    };

    executeAtomicTransition(record, () => {
      const db = getRawDb();
      db.prepare("INSERT INTO operation (id, type, actor_id, task_id, session_id, status, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("op-crash", "code_patch", "agent-1", "task-1", "session-1", "submitted", "Test op", new Date().toISOString(), new Date().toISOString());
    });

    const stuck = findIntermediateStateEntities("operation", ["applied", "rejected", "cancelled"]);
    expect(stuck.some(s => s.entityId === "op-crash")).toBe(true);

    const recoveryState = getRecoveryState("operation", "submit");
    expect(recoveryState).toBe("cancelled");

    // Force recover (ensure recovery log has a later timestamp)
    const db = getRawDb();
    db.prepare("UPDATE operation SET status = ? WHERE id = ?").run("cancelled", "op-crash");
    const recoveryTs = new Date(Date.now() + 1).toISOString();
    insertTransitionLog({
      entityType: "operation",
      entityId: "op-crash",
      fromState: "recovery",
      toState: "cancelled",
      operation: "force_recover",
      agentId: "system",
      createdAt: recoveryTs,
    });

    const postRecovery = findIntermediateStateEntities("operation", ["applied", "rejected", "cancelled"]);
    expect(postRecovery.some(s => s.entityId === "op-crash")).toBe(false);
  });
});

describe("fromState validation guard", () => {
  it("rejects transition when current state does not match fromState", () => {
    const db = getRawDb();
    const ts = new Date().toISOString();

    // Create a claim in 'active' state
    db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("claim-guard", "agent-1", "task-1", "session-1", "file", "exclusive", "active", ts);

    // Try to transition from 'none' → 'active' but entity is already 'active'
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-guard",
      fromState: "none",
      toState: "active",
      operation: "claim",
      agentId: "agent-1",
    };

    expect(() =>
      executeAtomicTransition(record, () => {
        db.prepare("UPDATE resource_claim SET status = ? WHERE id = ?").run("active", "claim-guard");
      }, { validateFromState: true })
    ).toThrow(StateTransitionError);

    // Verify the entity was NOT modified (transaction rolled back)
    const row = db.prepare("SELECT status FROM resource_claim WHERE id = ?").get("claim-guard") as { status: string };
    expect(row.status).toBe("active");
  });

  it("allows transition when current state matches fromState", () => {
    const db = getRawDb();
    const ts = new Date().toISOString();

    // Create a claim in 'active' state
    db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("claim-valid", "agent-1", "task-1", "session-1", "file", "exclusive", "active", ts);

    // Transition from 'active' → 'released' with validation
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-valid",
      fromState: "active",
      toState: "released",
      operation: "release",
      agentId: "agent-1",
    };

    expect(() =>
      executeAtomicTransition(record, () => {
        db.prepare("UPDATE resource_claim SET status = ? WHERE id = ?").run("released", "claim-valid");
      }, { validateFromState: true })
    ).not.toThrow();

    const row = db.prepare("SELECT status FROM resource_claim WHERE id = ?").get("claim-valid") as { status: string };
    expect(row.status).toBe("released");
  });

  it("skips validation by default (backward compat)", () => {
    const db = getRawDb();
    const ts = new Date().toISOString();

    // Create a claim in 'active' state
    db.prepare("INSERT INTO resource_claim (id, actor_id, task_id, session_id, resource_type, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("claim-compat", "agent-1", "task-1", "session-1", "file", "exclusive", "active", ts);

    // Transition from 'wrong_state' → 'released' WITHOUT validation — should succeed
    const record: StateTransitionRecord = {
      entityType: "resource_claim",
      entityId: "claim-compat",
      fromState: "wrong_state",
      toState: "released",
      operation: "release",
      agentId: "agent-1",
    };

    expect(() =>
      executeAtomicTransition(record, () => {
        db.prepare("UPDATE resource_claim SET status = ? WHERE id = ?").run("released", "claim-compat");
      })
    ).not.toThrow();
  });
});
