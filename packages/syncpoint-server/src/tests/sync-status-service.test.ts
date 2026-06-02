import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryKind, TaskStatus } from "syncpoint-core";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import { ensureApplicationBootstrap } from "../application/bootstrap.js";
import {
  orchAcceptAssignment,
  orchAssignRole,
  orchCreateSession,
  orchPlanTask,
  orchRequestReview,
} from "../application/orchestration-service.js";
import { stxCreate } from "../application/checkpoint-review-service.js";
import { opCreate, opSubmit } from "../application/operation-service.js";
import { pmAdd, pmApprove } from "../application/project-memory-service.js";
import { rcClaim } from "../application/resource-claim-service.js";
import { buildScopeFilter, buildSnapshot } from "../application/sync-status-service.js";
import { sgRequest } from "../application/sync-gate-service.js";
import { resetPathResolverCache } from "../application/path-resolver.js";

let tmpDir: string;
let sessionId: string;
let taskId: string;
let archId: string;
let execId: string;
let reviewerId: string;
let receiverId: string;
let transactionId: string;
let handoffId: string;
let reviewId: string;
let operationId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-sync-status-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  resetPathResolverCache();
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  ensureApplicationBootstrap();
  getDb();

  const architect = repo.createAgent({ name: "arch-sync", provider: "cursor", role: "manager" });
  const executor = repo.createAgent({ name: "exec-sync", provider: "codex", role: "backend" });
  const reviewer = repo.createAgent({ name: "review-sync", provider: "cursor", role: "reviewer" });
  const receiver = repo.createAgent({ name: "receiver-sync", provider: "claude-code", role: "backend" });
  archId = architect.id;
  execId = executor.id;
  reviewerId = reviewer.id;
  receiverId = receiver.id;

  const session = orchCreateSession({ title: "P1 sync status", createdBy: archId });
  sessionId = session.session.id;
  orchAssignRole({ sessionId, agentId: archId, role: "architect" as any });
  orchAssignRole({ sessionId, agentId: execId, role: "executor" as any });
  orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" as any });

  const task = repo.createTask({ title: "Sync status main task", description: "P1 service-level coverage" });
  taskId = task.id;
  const assignment = orchPlanTask({
    sessionId,
    taskId,
    assigneeAgentId: execId,
    assignedBy: archId,
  });
  orchAcceptAssignment(assignment.id);
  repo.updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

  const checkpoint = repo.createCheckpoint({
    taskId,
    agentId: execId,
    summary: "Checkpoint for sync status setup",
    progress: "in progress",
    risks: "",
    blockers: "",
    nextSteps: "",
    needSync: false,
    currentUnderstanding: "",
    changedResources: [],
  });
  repo.createContextSnapshot({
    taskId,
    agentId: execId,
    checkpointId: checkpoint.id,
    summary: "Constraint-visible snapshot",
    payload: {
      goal: "Cover sync status service",
      currentPhase: "implementation",
      workingResources: ["src/core/index.js"],
    },
  });

  const memory = pmAdd({
    category: "gotcha" as any,
    title: "Core freeze",
    content: "Do not touch src/core — it is under stability freeze.",
    createdBy: "architect",
    kind: MemoryKind.DO_NOT_TOUCH,
    appliesTo: { files: ["src/core"] },
    global: true,
  } as any);
  pmApprove(memory.id, "architect");

  rcClaim({
    actorId: execId,
    taskId,
    sessionId,
    mode: "exclusive",
    resources: [{ type: "file", locator: "src/feature/op-safe.js", metadata: "", scope: "file" as const }],
  });
  rcClaim({
    actorId: execId,
    taskId,
    sessionId,
    mode: "exclusive",
    autoGate: false,
    resources: [{ type: "file", locator: "src/feature/conflict.js", metadata: "", scope: "file" as const }],
  });

  const secondaryTask = repo.createTask({ title: "Sync status side task", description: "conflict seed" });
  rcClaim({
    actorId: reviewerId,
    taskId: secondaryTask.id,
    sessionId,
    mode: "exclusive",
    autoGate: false,
    resources: [{ type: "file", locator: "src/feature/conflict.js", metadata: "", scope: "file" as const }],
  });

  sgRequest({
    sessionId,
    taskId,
    reason: "manual_sync",
    description: "P1 snapshot gate",
    requestedByAgentId: execId,
    requiredAgentIds: [execId, archId],
  });

  const tx = stxCreate({
    sessionId,
    taskId,
    checkpointId: checkpoint.id,
    requestingAgentId: execId,
    requiredApproverIds: [archId, reviewerId],
  });
  transactionId = tx.tx.id;

  const handoff = repo.createHandoff({
    taskId,
    fromAgentId: execId,
    toAgentId: receiverId,
    contextSummary: "Need receiver follow-up",
  });
  handoffId = handoff.id;

  const review = orchRequestReview({
    sessionId,
    taskId,
    reviewerAgentId: reviewerId,
    requestedBy: archId,
  });
  reviewId = review.id;

  const operation = opCreate({
    type: "code_patch",
    actorId: execId,
    taskId,
    sessionId,
    title: "Update feature module",
    targetResources: [{ type: "file", locator: "src/feature/op-safe.js", metadata: "", scope: "file" as const }],
  });
  operationId = opSubmit(operation.id).operation.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  resetPathResolverCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sync-status-service", () => {
  it("buildScopeFilter returns stable scoped filters", () => {
    expect(buildScopeFilter()).toBeUndefined();
    expect(buildScopeFilter({ sessionId })).toEqual({ sessionId, taskId: undefined });
    expect(buildScopeFilter({ sessionId, taskId })).toEqual({ sessionId, taskId });
  });

  it("buildSnapshot classifies blockers from every pending collaboration source", () => {
    const snapshot = buildSnapshot({ sessionId, agentId: execId });
    const blockerTypes = snapshot.blockers.map(blocker => blocker.type);

    expect(blockerTypes).toEqual(expect.arrayContaining([
      "sync_gate",
      "checkpoint_review",
      "handoff",
      "review",
      "operation",
    ]));

    const gateBlocker = snapshot.blockers.find(blocker => blocker.description === "P1 snapshot gate");
    expect(gateBlocker).toBeDefined();
    expect(gateBlocker!.requiredAgents.map(agent => agent.name)).toEqual(expect.arrayContaining([
      "exec-sync",
      "arch-sync",
    ]));
    expect(gateBlocker!.gateDetails?.policy).toBeTruthy();
    expect(gateBlocker!.gateDetails?.requiredAgentIds).toEqual(expect.arrayContaining([execId, archId]));

    expect(snapshot.blockers.some(blocker => blocker.id === transactionId)).toBe(true);
    expect(snapshot.blockers.some(blocker => blocker.id === handoffId)).toBe(true);
    expect(snapshot.blockers.some(blocker => blocker.id === reviewId)).toBe(true);
    expect(snapshot.blockers.some(blocker => blocker.id === operationId)).toBe(true);
  });

  it("buildSnapshot assembles resource and operation aggregate views", () => {
    const snapshot = buildSnapshot({ sessionId });

    expect(snapshot.resourceOwnership.activeClaims.some(claim =>
      claim.resources.some(resource => resource.locator.includes("src/feature/op-safe.js"))
    )).toBe(true);
    expect(snapshot.resourceOwnership.conflicts.some(conflict =>
      conflict.isHardConflict && conflict.overlappingLocator.includes("src/feature/conflict.js")
    )).toBe(true);
    expect(snapshot.resourceOwnership.stats.hardConflicts).toBeGreaterThanOrEqual(1);
    expect(snapshot.resourceOwnership.stats.totalClaims).toBeGreaterThanOrEqual(3);

    const operation = snapshot.operations.find(item => item.id === operationId);
    expect(operation).toBeDefined();
    expect(operation!.status).toBe("SUBMITTED");
    expect(operation!.needsAction).toBe("approve_or_reject");
    expect(operation!.actorName).toBe("exec-sync");
    expect(snapshot.summary.pendingOperationCount).toBeGreaterThanOrEqual(1);
  });

  it("buildSnapshot surfaces constraint visibility without leaking raw memory content", () => {
    const snapshot = buildSnapshot({ sessionId });
    const executor = snapshot.agents.find(agent => agent.id === execId);
    const architect = snapshot.agents.find(agent => agent.id === archId);

    expect(executor).toBeDefined();
    expect(executor!.constraintBlocked).toBe(true);
    expect(executor!.constraintBlockerCount).toBeGreaterThan(0);
    expect(snapshot.summary.constraintBlockedAgents).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.constraintBlockedTasks).toBeGreaterThanOrEqual(1);

    expect(architect).toBeDefined();
    expect(architect!.constraintBlocked).toBe(false);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("under stability freeze");
    expect(serialized).not.toContain("Do not touch src/core");
  });
});
