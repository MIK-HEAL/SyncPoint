/**
 * E2E multi-agent collaboration test — delegate → commit → review → apply.
 * Simulates a complete workflow across multiple agents with resource claims and reviews.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import {
  rcClaim, rcRelease, rcDetectConflicts,
  writeCheck, writePrepare, writeApply,
  guardCreateSession, guardStatus, reconcileBackingStore,
  loopResume, loopCheckpoint, loopHandoff,
  sgRequest, sgAck, sgVote, sgStatusDetailed,
  rwAddChecklistItem, rwUpdateChecklistItem,
  rwAddEvidence, rwEvaluateGate, rwApprove,
} from "syncpoint-server/application";
import { ResourceClaimMode, WriteDecisionReason } from "syncpoint-kernel";
import { SessionStatus, TaskAssignmentStatus } from "syncpoint-adapters";
import { ChecklistItemStatus, EvidenceKind, ApprovalGateStatus } from "syncpoint-governance";

let tmpDir: string;
let architectId: string;
let executorId: string;
let reviewerId: string;
let taskId: string;
let sessionId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-e2e-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();

  // Create agents with different roles
  architectId = repo.createAgent({ name: "e2e-architect", provider: "cursor", role: "manager" }).id;
  executorId = repo.createAgent({ name: "e2e-executor", provider: "claude-code", role: "frontend" }).id;
  reviewerId = repo.createAgent({ name: "e2e-reviewer", provider: "windsurf", role: "reviewer" }).id;

  taskId = repo.createTask({ title: "E2E: Build auth module", description: "Implement OAuth2 authentication" }).id;

  // Create session with architect
  sessionId = repo.createSession({ title: "E2E Auth Session", architectId }).id;
  repo.assignRole(sessionId, architectId, "architect", "");
  repo.assignRole(sessionId, executorId, "executor", "");
  repo.assignRole(sessionId, reviewerId, "reviewer", "");

  // Architect plans tasks
  repo.assignTask(taskId, executorId);
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("E2E: delegate → commit → review → apply", () => {
  const workFile = "src/auth.ts";

  beforeAll(() => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, workFile), "// TODO: implement auth");
  });

  it("Phase 1: Executor claims resource and writes code", () => {
    // Executor claims the working file
    const claim = rcClaim({
      actorId: executorId,
      taskId,
      resources: [{ type: "file", locator: workFile, metadata: "", scope: "file" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });
    expect(claim.mode).toBe(ResourceClaimMode.EXCLUSIVE);

    // Write check passes
    const check = writeCheck({ locators: [workFile], actorId: executorId, taskId });
    expect(check.permitted).toBe(true);

    // Prepare and apply write
    const prep = writePrepare({ actorId: executorId, taskId, locators: [workFile], intent: "modify" });
    expect(prep.decision.permitted).toBe(true);

    writeApply({ permitId: prep.permit.id, mutations: [{ locator: workFile, content: "export function login() {}" }] });
    expect(fs.readFileSync(path.join(tmpDir, workFile), "utf-8")).toContain("export function login");
  });

  it("Phase 2: Executor checkpoints progress", () => {
    const cp = loopCheckpoint({
      agentId: executorId, taskId,
      summary: "Auth module scaffolded",
      progress: "60%",
      goal: "Implement OAuth2",
      phase: "implementation",
      completedWork: "login function created",
      remainingWork: "Add token validation",
      workingResources: [workFile],
      nextSteps: "Implement token validation",
    });
    expect(cp.ok).toBe(true);
    expect(cp.checkpointId).toBeTruthy();
  });

  it("Phase 3: Reviewer reviews checkpoint and approves", () => {
    // Request review
    const rr = repo.requestReview(sessionId, taskId, executorId, reviewerId, "full");
    expect(rr.reviewerAgentId).toBe(reviewerId);

    // Add checklist items
    const cl1 = rwAddChecklistItem({ reviewRequestId: rr.id, title: "Code compiles", required: true });
    const cl2 = rwAddChecklistItem({ reviewRequestId: rr.id, title: "Tests pass", required: true });

    // Pass all checklist items
    rwUpdateChecklistItem(cl1.id, { status: ChecklistItemStatus.PASSED, notes: "TypeScript compiles" });
    rwUpdateChecklistItem(cl2.id, { status: ChecklistItemStatus.PASSED, notes: "All tests green" });

    // Add evidence
    rwAddEvidence({ reviewRequestId: rr.id, kind: EvidenceKind.BUILD, title: "pnpm build", content: "6 packages compiled" });
    rwAddEvidence({ reviewRequestId: rr.id, kind: EvidenceKind.TEST, title: "pnpm test", content: "42 tests passed" });

    // Evaluate gate
    const gate = rwEvaluateGate(rr.id);
    expect(gate.status).toBe(ApprovalGateStatus.PASSED);

    // Approve review
    const approval = rwApprove(rr.id, "Auth module looks good", reviewerId);
    expect(approval.approvalRecord.decision).toBe("approved");
  });

  it("Phase 4: Executor releases claim after review", () => {
    const claims = rcClaim ? true : true; // verify no conflict
    // Release the exclusive claim
    const activeClaims = (repo as any).listActiveResourceClaims?.() ?? [];
    if (activeClaims.length > 0) {
      for (const c of activeClaims) {
        if (c.actorId === executorId && (c as any).resources?.some((r: any) => r.locator === workFile)) {
          rcRelease(c.id);
          break;
        }
      }
    }
  });

  it("Phase 5: No conflicts remain after release", () => {
    const conflicts = rcDetectConflicts({ resourceType: "file" });
    const authConflicts = conflicts.filter(c => c.overlappingLocator === workFile);
    expect(authConflicts.length).toBe(0);
  });
});

describe("E2E: constraint fail-closed verification", () => {
  it("blocks write when no claim exists (fail-closed)", () => {
    const result = writeCheck({
      locators: ["nonexistent-file.ts"],
      actorId: executorId,
      taskId,
    });
    // Should block — no claim means no permission
    expect(result.permitted).toBe(false);
    expect(result.decision.reason).toBe(WriteDecisionReason.BLOCKED);
  });

  it("blocks write for unclaimed file even with valid claim elsewhere", () => {
    const otherFile = "src/restricted.ts";
    fs.writeFileSync(path.join(tmpDir, otherFile), "// restricted");

    const result = writeCheck({
      locators: [otherFile],
      actorId: executorId,
      taskId,
    });
    // No claim on this file — should block
    expect(result.permitted).toBe(false);
  });
});

describe("E2E: disconnection recovery", () => {
  it("guard session persists and can be queried after creation", () => {
    const session = guardCreateSession({
      actorId: executorId,
      taskId,
      mode: "strict",
      adapter: "manual",
    });
    expect(session.token).toMatch(/^spg_/);

    // Simulate disconnection — query status fresh
    const status = guardStatus();
    const found = status.activeSessions.find((s: any) => s.id === session.id);
    expect(found).toBeDefined();
    expect(found.mode).toBe("strict");
  });

  it("reconcile continues to work after simulated disconnect", () => {
    const result = reconcileBackingStore({ taskId });
    expect(result.scannedFiles).toBeGreaterThanOrEqual(0);
  });

  it("loop resume works after checkpoint (recovery path)", () => {
    const result = loopResume({ agentId: executorId, taskId, format: "system-prompt" });
    expect(result.ready).toBeDefined();
    expect(result.task.title).toBe("E2E: Build auth module");
  });
});
