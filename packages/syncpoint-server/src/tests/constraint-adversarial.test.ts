/**
 * Track 2: Adversarial constraint bypass tests.
 *
 * Verifies that constraints cannot be circumvented through:
 *   1. Mode switching (snapshot-locked → default should still block)
 *   2. Projection unavailable (fail-closed, not fail-open)
 *   3. Multiple entry points all enforce consistently
 *   4. SyncGate + constraint interaction (gate resolve doesn't skip constraints)
 *   5. Operation apply after constraint added mid-flight
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import { ensureApplicationBootstrap } from "../application/bootstrap.js";
import { loopResume } from "../application/loop-service.js";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
} from "../application/orchestration-service.js";
import { wakeNext, wakeStart, wakeEngineStart, wakeEngineStop } from "../application/wake-engine-service.js";
import { sgRequest, sgAck, sgResolve, sgCheckAgent } from "../application/sync-gate-service.js";
import { opCreate, opSubmit, opApprove, opApply } from "../application/operation-service.js";
import { pmAdd, pmApprove } from "../application/project-memory-service.js";
import { MemoryKind, TaskStatus, WakeRequestStatus } from "syncpoint-core";

let tmpDir: string;
let architectId: string;
let executorId: string;
let taskId: string;
let sessionId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-adv-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  ensureApplicationBootstrap();
  getDb();
  wakeEngineStart();

  const a1 = repo.createAgent({ name: "architect", provider: "claude-code", role: "manager" });
  const a2 = repo.createAgent({ name: "executor", provider: "codex", role: "backend" });
  architectId = a1.id;
  executorId = a2.id;

  const t = repo.createTask({ title: "Adversarial test task", description: "" });
  taskId = t.id;
  repo.assignTask(taskId, executorId);
  repo.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

  const sess = orchCreateSession({ title: "Adversarial test session", createdBy: architectId });
  sessionId = sess.session.id;
  orchAssignRole({ sessionId, agentId: architectId, role: "architect" as any });
  orchAssignRole({ sessionId, agentId: executorId, role: "executor" as any });

  // Create checkpoint + snapshot with protected working resources
  const cp = repo.createCheckpoint({
    taskId,
    agentId: executorId,
    summary: "Initial",
    progress: "started",
    risks: "",
    blockers: "",
    nextSteps: "",
    needSync: false,
    currentUnderstanding: "",
    changedResources: [],
  });
  repo.createContextSnapshot({
    taskId,
    agentId: executorId,
    checkpointId: cp.id,
    summary: "test",
    payload: {
      goal: "test",
      currentPhase: "development",
      workingResources: ["src/protected/core.ts", "src/protected/db.ts"],
    },
  });

  // Seed: do_not_touch memory protecting src/protected
  const m = pmAdd({
    category: "gotcha" as any,
    title: "Protected zone",
    content: "Do not touch src/protected",
    createdBy: "architect",
    kind: MemoryKind.DO_NOT_TOUCH,
    appliesTo: { files: ["src/protected"] },
    global: true,
  } as any);
  pmApprove(m.id, "architect");
});

afterAll(() => {
  wakeEngineStop();
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Bypass vector 1: mode switching ──────────────────────

describe("Adversarial: mode switching does not bypass constraints", () => {
  it("default mode blocks on constraint violation (not just snapshot-locked)", () => {
    expect(() => loopResume({ agentId: executorId, taskId })).toThrow(/Constraint violation/);
  });

  it("snapshot-locked mode also blocks on same violation", () => {
    expect(() => loopResume({
      agentId: executorId,
      taskId,
      contextMode: "snapshot-locked",
    })).toThrow(/Constraint violation/);
  });

  it("snapshot-first mode also blocks on same violation", () => {
    expect(() => loopResume({
      agentId: executorId,
      taskId,
      contextMode: "snapshot-first",
    })).toThrow(/Constraint violation/);
  });
});

// ── Bypass vector 2: gate resolve does not skip constraints ────

describe("Adversarial: gate resolve does not bypass constraint check", () => {
  let gateId: string;

  it("setup: create and resolve a gate for executor", () => {
    const r = sgRequest({
      sessionId,
      taskId,
      requestedByAgentId: architectId,
      requiredAgentIds: [executorId],
      reason: "manual_request",
      description: "Test gate",
    });
    gateId = r.gate.id;
    sgAck(gateId, executorId, "acked");
    sgResolve(gateId, "resolved");

    // Gate is resolved — agent is unblocked by gate
    const check = sgCheckAgent(executorId, { taskId });
    expect(check.blocked).toBe(false);
  });

  it("loopResume still blocked by constraint even after gate resolved", () => {
    // Gate is resolved but constraint is still active — must still block
    expect(() => loopResume({ agentId: executorId, taskId })).toThrow(/Constraint violation/);
  });
});

// ── Bypass vector 3: operation apply after constraint added ────

describe("Adversarial: operation apply blocked by late-added constraint", () => {
  let opId: string;
  let memoryId: string;

  it("setup: create and submit operation before constraint exists", () => {
    // Create a second task with its own agent that has no existing constraints
    const safeTask = repo.createTask({ title: "Safe op task", description: "" });
    repo.assignTask(safeTask.id, executorId);
    repo.updateTaskStatus(safeTask.id, TaskStatus.IN_PROGRESS);

    const op = opCreate({
      taskId: safeTask.id,
      actorId: executorId,
      type: "file_write",
      title: "Write to api handler",
      targetResources: [{ type: "file", locator: "src/api/handler.ts", metadata: "", scope: "file" as const }],
    });
    opId = op.id;
    opSubmit(opId);
    opApprove(opId, architectId, "approved before constraint added");

    // Now add a constraint that covers this resource
    const m = pmAdd({
      category: "gotcha" as any,
      title: "API frozen",
      content: "Do not touch api handlers",
      createdBy: "architect",
      kind: MemoryKind.DO_NOT_TOUCH,
      appliesTo: { files: ["src/api"] },
      global: true,
    } as any);
    memoryId = m.id;
    pmApprove(memoryId, "architect");
  });

  it("opApply blocked by constraint added after submit", () => {
    expect(() => opApply(opId)).toThrow(/blocked by constraint runtime/i);
  });
});

// ── Bypass vector 4: wakeStart / wakeNext enforce constraints ────

describe("Adversarial: wake entry points enforce constraints", () => {
  let wakeReqId: string;

  it("setup: create wake request for constrained agent", () => {
    wakeReqId = repo.createWakeRequest({
      sessionId,
      targetAgentId: executorId,
      targetRole: "executor",
      action: "accept-assignment",
      reason: "adversarial test",
      runnerMode: "manual",
      triggerEventType: "TEST",
      triggerEntityId: taskId,
      taskId,
      reviewRequestId: null,
      promptHint: "",
      mcpToolHint: "",
      cliHint: "",
    }).id;
  });

  it("wakeNext returns null when agent has constraint violations", () => {
    const result = wakeNext(executorId);
    expect(result).toBeNull();
  });

  it("wakeStart throws when agent has constraint violations", () => {
    repo.updateWakeRequestStatus(wakeReqId, WakeRequestStatus.DISPATCHED);
    expect(() => wakeStart(wakeReqId)).toThrow();
  });
});

// ── Bypass vector 5: consistent error messaging ────

describe("Adversarial: constraint error messages are informative", () => {
  it("loopResume error includes blocker details", () => {
    try {
      loopResume({ agentId: executorId, taskId });
      expect.unreachable("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("Constraint violation");
      // Should include the human-readable blocker message
      expect(msg).toContain("protected");
    }
  });
});
