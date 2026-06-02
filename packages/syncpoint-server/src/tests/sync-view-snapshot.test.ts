/**
 * P9 Sync View Snapshot — integration tests.
 * Verifies the syncStatus.snapshot endpoint shape and content.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchAdvanceSession,
  orchRequestReview,
} from "../application/orchestration-service.js";
import { rcClaim } from "../application/resource-claim-service.js";
import { opCreate, opSubmit } from "../application/operation-service.js";
import { sgRequest } from "../application/sync-gate-service.js";
import { appRouter } from "../../src/router.js";
import { resetPathResolverCache } from "../application/path-resolver.js";

let tmpDir: string;
let archId: string;
let execId: string;
let reviewerId: string;
let sessionId: string;
let taskId: string;

const caller = appRouter.createCaller({ callerId: "test-caller", callerRole: null, callerToken: null });

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-p9-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  resetPathResolverCache();
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const a = repo.createAgent({ name: "arch-p9", provider: "cursor", role: "manager" });
  const e = repo.createAgent({ name: "exec-p9", provider: "codex", role: "backend" });
  const r = repo.createAgent({ name: "rev-p9", provider: "cursor", role: "reviewer" });
  archId = a.id;
  execId = e.id;
  reviewerId = r.id;

  const sess = orchCreateSession({ title: "P9 snapshot test", createdBy: archId });
  sessionId = sess.session.id;
  orchAssignRole({ sessionId, agentId: archId, role: "architect" as any });
  orchAssignRole({ sessionId, agentId: execId, role: "executor" as any });
  orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" as any });

  const t = repo.createTask({ title: "Snapshot feature", description: "Test task" });
  taskId = t.id;

  orchPlanTask({ sessionId, taskId, assigneeAgentId: execId, assignedBy: archId });
  orchAdvanceSession(sessionId);
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  resetPathResolverCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("syncStatus.snapshot", () => {
  it("returns valid shape with summary", async () => {
    const snap = await caller.syncStatus.snapshot();
    expect(snap.timestamp).toBeTruthy();
    expect(snap.summary).toBeTruthy();
    expect(snap.sessions).toBeInstanceOf(Array);
    expect(snap.agents).toBeInstanceOf(Array);
    expect(snap.resourceOwnership).toBeTruthy();
    expect(snap.blockers).toBeInstanceOf(Array);
    expect(snap.operations).toBeInstanceOf(Array);
    expect(snap.wakeQueue).toBeInstanceOf(Array);
    expect(snap.gateStats).toBeTruthy();
  });

  it("shows session with agent roles", async () => {
    const snap = await caller.syncStatus.snapshot();
    const sess = snap.sessions.find(s => s.id === sessionId);
    expect(sess).toBeTruthy();
    expect(sess!.agents.length).toBe(3);
    expect(sess!.agents.map(a => a.role)).toContain("executor");
  });

  it("shows agent with active assignment", async () => {
    const snap = await caller.syncStatus.snapshot();
    const exec = snap.agents.find(a => a.id === execId);
    expect(exec).toBeTruthy();
    expect(exec!.activeAssignments.length).toBeGreaterThanOrEqual(1);
    expect(exec!.activeAssignments[0].taskTitle).toBe("Snapshot feature");
  });

  it("resource claims appear in resourceOwnership", async () => {
    rcClaim({
      actorId: execId,
      taskId,
      sessionId,
      resources: [{ type: "file", locator: "src/snapshot.ts", metadata: "", scope: "file" as const }],
    });
    const snap = await caller.syncStatus.snapshot();
    expect(snap.resourceOwnership.activeClaims.length).toBeGreaterThanOrEqual(1);
    const claim = snap.resourceOwnership.activeClaims.find((c: any) =>
      c.resources?.some((r: any) => r.locator.includes("src/snapshot.ts"))
    );
    expect(claim).toBeTruthy();
    expect(claim!.actorName).toBe("exec-p9");
  });

  it("sync gate appears in blockers", async () => {
    sgRequest({
      taskId,
      sessionId,
      reason: "manual_sync",
      description: "P9 test gate",
      requestedByAgentId: execId,
      requiredAgentIds: [execId, archId],
    });

    const snap = await caller.syncStatus.snapshot();
    const gateBlocker = snap.blockers.find((b: any) => b.type === "sync_gate");
    expect(gateBlocker).toBeTruthy();
    expect(gateBlocker!.requiredAgents.length).toBe(2);
  });

  it("summary counts are accurate", async () => {
    const snap = await caller.syncStatus.snapshot();
    expect(snap.summary.activeSessionCount).toBeGreaterThanOrEqual(1);
    expect(snap.summary.agentCount).toBeGreaterThanOrEqual(3);
    expect(snap.summary.blockerCount).toBeGreaterThanOrEqual(1);
    expect(snap.summary.activeClaimCount).toBeGreaterThanOrEqual(1);
  });
});

// ── sessionId scoping ──

describe("syncStatus.snapshot sessionId scoping", () => {
  let otherSessionId: string;
  let otherTaskId: string;
  let otherExecId: string;

  beforeAll(() => {
    // Create a second session with its own data
    const otherExec = repo.createAgent({ name: "other-exec", provider: "codex", role: "backend" });
    otherExecId = otherExec.id;

    const sess2 = orchCreateSession({ title: "Other session", createdBy: archId });
    otherSessionId = sess2.session.id;
    orchAssignRole({ sessionId: otherSessionId, agentId: archId, role: "architect" as any });
    orchAssignRole({ sessionId: otherSessionId, agentId: otherExecId, role: "executor" as any });

    const t2 = repo.createTask({ title: "Other task", description: "" });
    otherTaskId = t2.id;
    orchPlanTask({ sessionId: otherSessionId, taskId: otherTaskId, assigneeAgentId: otherExecId, assignedBy: archId });
    orchAdvanceSession(otherSessionId);

    // Claim in session 2
    rcClaim({ actorId: otherExecId, taskId: otherTaskId, sessionId: otherSessionId, resources: [{ type: "file", locator: "src/other.ts", metadata: "", scope: "file" as const }] });
    // Gate in session 2
    sgRequest({
      taskId: otherTaskId, sessionId: otherSessionId, reason: "manual_sync",
      description: "Other gate", requestedByAgentId: otherExecId,
      requiredAgentIds: [otherExecId],
    });
  });

  it("scoped snapshot only shows the requested session", async () => {
    const scoped = await caller.syncStatus.snapshot({ sessionId });
    expect(scoped.sessions.length).toBe(1);
    expect(scoped.sessions[0].id).toBe(sessionId);
  });

  it("scoped snapshot excludes claims from other sessions", async () => {
    const scoped = await caller.syncStatus.snapshot({ sessionId });
    const otherClaim = scoped.resourceOwnership.activeClaims.find((c: any) =>
      c.resources?.some((r: any) => r.locator.includes("src/other.ts"))
    );
    expect(otherClaim).toBeUndefined();
  });

  it("scoped snapshot excludes gates from other sessions", async () => {
    const scoped = await caller.syncStatus.snapshot({ sessionId });
    const otherGate = scoped.blockers.find((b: any) => b.description === "Other gate");
    expect(otherGate).toBeUndefined();
  });

  it("scoped snapshot excludes blockingGateIds from other sessions", async () => {
    // otherExecId is blocked by a gate in otherSessionId
    const global = await caller.syncStatus.snapshot();
    const otherGlobal = global.agents.find(a => a.id === otherExecId);
    expect(otherGlobal!.blockingGateIds.length).toBeGreaterThanOrEqual(1);

    // Scoped to session 1 — otherExec should have no blockingGateIds
    const scoped = await caller.syncStatus.snapshot({ sessionId });
    const otherScoped = scoped.agents.find(a => a.id === otherExecId);
    expect(otherScoped!.blockingGateIds.length).toBe(0);
    expect(otherScoped!.blocked).toBe(false);
  });

  it("global snapshot includes both sessions", async () => {
    const global = await caller.syncStatus.snapshot();
    expect(global.sessions.length).toBe(2);
    expect(global.resourceOwnership.activeClaims.some((c: any) =>
      c.resources?.some((r: any) => r.locator.includes("src/other.ts"))
    )).toBe(true);
    expect(global.resourceOwnership.activeClaims.some((c: any) =>
      c.resources?.some((r: any) => r.locator.includes("src/snapshot.ts"))
    )).toBe(true);
  });
});

// ── Operation as blocker ──

describe("syncStatus.snapshot operation blockers", () => {
  it("SUBMITTED operation appears in blockers", async () => {
    const op = opCreate({
      type: "code_patch",
      actorId: execId,
      taskId,
      sessionId,
      title: "Fix typo",
    });
    opSubmit(op.id);

    const snap = await caller.syncStatus.snapshot();
    const opBlocker = snap.blockers.find((b: any) =>
      b.type === "operation" && b.id === op.id
    );
    expect(opBlocker).toBeTruthy();
    expect(opBlocker!.reason).toBe("operation_awaiting_approval");
    // Also in blockerCount
    expect(snap.summary.blockerCount).toBeGreaterThanOrEqual(1);
  });
});
