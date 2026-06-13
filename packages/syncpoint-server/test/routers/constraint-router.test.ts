/**
 * Tests for constraint router — Constraint check operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { constraintCheck } from "../../src/application/_exports/review-operation-status.js";
import { rcClaim, pmAdd, pmApprove } from "../../src/application/_exports/review-operation-status.js";
import { ResourceClaimMode } from "syncpoint-kernel";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-const-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  agentId = repo.createAgent({ name: "const-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "Constraint router task" }).id;
  const cp = repo.createCheckpoint({ taskId, agentId, summary: "Start", progress: "0%", currentUnderstanding: "", changedResources: [], risks: "", blockers: "", nextSteps: "Go", needSync: false });
  repo.createContextSnapshot({ taskId, agentId, checkpointId: cp.id, summary: "Seed", payload: { goal: "Test constraints", currentPhase: "dev", confirmedDecisions: [], interfaceContract: "", workingResources: ["src/const-test.ts"], completedWork: "", remainingWork: "Test", risks: [], blockers: [], nextSteps: ["Run"], resumePrompt: "" } });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("constraint router", () => {
  it("checks constraint for resume action", () => {
    const result = constraintCheck({ action: "resume", taskId, agentId });
    expect(result.action).toBe("resume");
    expect(result.permitted).toBeDefined();
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("checks constraint with touched resources", () => {
    const result = constraintCheck({ action: "resume", taskId, agentId, touchedResources: ["src/override.ts"] });
    expect(result.action).toBe("resume");
  });

  it("checks constraint for start_assignment", () => {
    // Create assignment first
    const s = repo.createSession({ title: "Const Session" });
    repo.assignRole(s.id, agentId, "executor", "");
    const asgn = repo.assignTask(taskId, agentId);
    const result = constraintCheck({ action: "start_assignment", assignmentId: asgn.id });
    expect(result.action).toBe("start_assignment");
  });
});
