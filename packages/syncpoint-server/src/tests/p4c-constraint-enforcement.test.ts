/**
 * P4C: Constraint Runtime enforcement integration tests.
 * Verifies that constraint violations block loopResume, orchStartAssignment,
 * wakeStart, and wakeNext at the execution entry points.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import { loopResume } from "../application/loop-service.js";
import { orchCreateSession, orchAssignRole, orchPlanTask, orchAcceptAssignment, orchStartAssignment } from "../application/orchestration-service.js";
import { wakeNext, wakeStart, wakeEngineStart, wakeEngineStop } from "../application/wake-engine-service.js";
import { rcClaim } from "../application/resource-claim-service.js";
import { pmAdd, pmApprove } from "../application/project-memory-service.js";
import { MemoryKind, TaskStatus, WakeRequestStatus } from "syncpoint-core";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let taskId: string;
let sessionId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-p4c-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();
  wakeEngineStart();

  const a1 = repo.createAgent({ name: "architect", provider: "claude-code", role: "manager" });
  const a2 = repo.createAgent({ name: "executor", provider: "codex", role: "backend" });
  agent1Id = a1.id;
  agent2Id = a2.id;

  const t = repo.createTask({ title: "P4C test task", description: "" });
  taskId = t.id;
  repo.assignTask(taskId, agent2Id);
  repo.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

  const sess = orchCreateSession({ title: "P4C session", createdBy: agent1Id });
  sessionId = sess.session.id;
  orchAssignRole({ sessionId, agentId: agent1Id, role: "architect" as any });
  orchAssignRole({ sessionId, agentId: agent2Id, role: "executor" as any });

  // Create checkpoint + capsule so loopResume can proceed past context policy check
  const cp = repo.createCheckpoint({
    taskId,
    agentId: agent2Id,
    summary: "Initial setup",
    progress: "started",
    risks: "",
    blockers: "",
    nextSteps: "",
    needSync: false,
    currentUnderstanding: "",
    changedFiles: "",
  });
  repo.createCapsule({
    taskId,
    agentId: agent2Id,
    checkpointId: cp.id,
    goal: "test",
    currentPhase: "development",
    workingResources: "src/core/index.ts,src/core/utils.ts",
  } as any);

  // Seed: do_not_touch memory protecting src/core (project-wide, no appliesTo filter)
  // This will be picked up by projection and trigger do_not_touch_scope_overlap
  // when touchedResources (from capsule workingResources) overlap with the scope.
  const m1 = pmAdd({
    category: "gotcha" as any,
    title: "Core is frozen",
    content: "Do not touch src/core",
    createdBy: "architect",
    kind: MemoryKind.DO_NOT_TOUCH,
    appliesTo: { files: ["src/core"] },
    global: true,
  } as any);
  pmApprove(m1.id, "architect");
});

afterAll(() => {
  wakeEngineStop();
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("P4C: loopResume constraint enforcement", () => {
  it("loopResume in capsule-locked mode throws on projection_conflict", () => {
    expect(() => loopResume({
      agentId: agent2Id,
      taskId,
      contextMode: "capsule-locked",
    })).toThrow(/Constraint violation.*locked mode/);
  });

  it("loopResume in default mode returns constraintWarnings (not throw)", () => {
    const result = loopResume({ agentId: agent2Id, taskId });
    expect(result.ok).toBe(true);
    expect(result.constraintWarnings.length).toBeGreaterThan(0);
    // Should contain do_not_touch blocker (workingResources overlap protected scope)
    expect(result.constraintWarnings.some(w => w.includes("do_not_touch_scope_overlap"))).toBe(true);
  });

  it("constraintWarnings include rule name and [BLOCKED] prefix", () => {
    const result = loopResume({ agentId: agent2Id, taskId });
    const blockerWarning = result.constraintWarnings.find(w => w.includes("do_not_touch_scope_overlap"));
    expect(blockerWarning).toBeDefined();
    expect(blockerWarning).toContain("[BLOCKED]");
  });
});

describe("P4C: orchStartAssignment constraint enforcement", () => {
  let assignmentId: string;

  beforeAll(() => {
    const task2 = repo.createTask({ title: "P4C assignment task", description: "" });
    const assignment = orchPlanTask({
      sessionId,
      taskId: task2.id,
      assigneeAgentId: agent2Id,
      assignedBy: agent1Id,
    });
    assignmentId = assignment.id;
    orchAcceptAssignment(assignmentId);

    // Claim resources that overlap with do_not_touch scope
    rcClaim({
      sessionId,
      actorId: agent2Id,
      taskId: task2.id,
      resources: [{ type: "file", locator: "src/core/index.ts", metadata: "" }],
      mode: "exclusive",
      autoGate: false,
    });
  });

  it("orchStartAssignment throws on constraint violation", () => {
    expect(() => orchStartAssignment(assignmentId)).toThrow(/Constraint violation/);
  });
});

describe("P4C: orchStartAssignment not polluted by other agent's claims", () => {
  it("agent without protected claims can start assignment even if another agent has them", () => {
    // agent1 has NO claims on protected files — should start fine
    const safeTask = repo.createTask({ title: "Safe task for agent1", description: "" });
    const assignment = orchPlanTask({
      sessionId,
      taskId: safeTask.id,
      assigneeAgentId: agent1Id,
      assignedBy: agent1Id,
    });
    orchAcceptAssignment(assignment.id);

    // agent1 has no file claims at all — orchStartAssignment should succeed
    const ta = orchStartAssignment(assignment.id);
    expect(ta.status).toBe("IN_PROGRESS");
  });
});

describe("P4C: wakeStart constraint enforcement", () => {
  let wakeReqId: string;
  let wakeTaskId: string;

  beforeAll(() => {
    // Create a separate task with capsule whose workingResources overlap with protected scope
    const wTask = repo.createTask({ title: "Wake constraint task", description: "" });
    wakeTaskId = wTask.id;
    repo.assignTask(wakeTaskId, agent2Id);
    repo.updateTaskStatus(wakeTaskId, TaskStatus.IN_PROGRESS);

    const wCp = repo.createCheckpoint({
      taskId: wakeTaskId,
      agentId: agent2Id,
      summary: "setup",
      progress: "",
      risks: "",
      blockers: "",
      nextSteps: "",
      needSync: false,
      currentUnderstanding: "",
      changedFiles: "",
    });
    repo.createCapsule({
      taskId: wakeTaskId,
      agentId: agent2Id,
      checkpointId: wCp.id,
      goal: "test",
      currentPhase: "development",
      workingResources: "src/core/index.ts",
    } as any);

    // Create a wake request for the constrained task
    const wr = repo.createWakeRequest({
      sessionId,
      taskId: wakeTaskId,
      targetAgentId: agent2Id,
      targetRole: "executor",
      triggerEventType: "test",
      triggerEntityId: wakeTaskId,
      action: "execute-task",
      reason: "test constraint enforcement",
      reviewRequestId: null,
      promptHint: "test",
      mcpToolHint: "test",
      cliHint: "test",
      runnerMode: "manual",
    });
    wakeReqId = wr.id;
  });

  it("wakeStart throws on constraint violation", () => {
    repo.updateWakeRequestStatus(wakeReqId, WakeRequestStatus.DISPATCHED);
    expect(() => wakeStart(wakeReqId)).toThrow(/Constraint violation/);
  });
});

describe("P4C: wakeNext constraint enforcement", () => {
  let wakeNextTaskId: string;

  beforeAll(() => {
    // Create a task with capsule whose workingResources overlap do_not_touch scope
    const wnTask = repo.createTask({ title: "Wake next constraint task", description: "" });
    wakeNextTaskId = wnTask.id;
    repo.assignTask(wakeNextTaskId, agent1Id);
    repo.updateTaskStatus(wakeNextTaskId, TaskStatus.IN_PROGRESS);

    const wnCp = repo.createCheckpoint({
      taskId: wakeNextTaskId,
      agentId: agent1Id,
      summary: "setup",
      progress: "",
      risks: "",
      blockers: "",
      nextSteps: "",
      needSync: false,
      currentUnderstanding: "",
      changedFiles: "",
    });
    repo.createCapsule({
      taskId: wakeNextTaskId,
      agentId: agent1Id,
      checkpointId: wnCp.id,
      goal: "test",
      currentPhase: "development",
      workingResources: "src/core/main.ts",
    } as any);

    // Create a QUEUED wake request for agent1 on this constrained task
    repo.createWakeRequest({
      sessionId,
      taskId: wakeNextTaskId,
      targetAgentId: agent1Id,
      targetRole: "architect",
      triggerEventType: "test_next",
      triggerEntityId: wakeNextTaskId,
      action: "resume-work",
      reason: "test constraint enforcement",
      reviewRequestId: null,
      promptHint: "test",
      mcpToolHint: "test",
      cliHint: "test",
      runnerMode: "manual",
    });
  });

  it("wakeNext returns null when agent's capsule workingResources overlap do_not_touch", () => {
    const result = wakeNext(agent1Id);
    expect(result).toBeNull();
  });
});
