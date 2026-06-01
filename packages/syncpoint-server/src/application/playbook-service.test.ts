/**
 * Tests for playbook-service.ts — next-action, evidence capture, active session.
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
  orchCompleteAssignment,
  orchRequestReview,
  orchAdvanceSession,
} from "./orchestration-service.js";
import {
  rwCreateChecklistItem,
  rwUpdateChecklistItem,
  rwAddEvidence,
} from "./review-workflow-service.js";
import { pbGetNextAction, pbCaptureEvidence, pbGetActiveSession } from "./playbook-service.js";
import { rcClaim } from "./resource-claim-service.js";
import { ChecklistItemStatus } from "syncpoint-core";

let tmpDir: string;
let architectId: string;
let executorId: string;
let reviewerId: string;
let sessionId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-pb-svc-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const arch = repo.createAgent({ name: "architect-agent", provider: "cursor", role: "manager" });
  const exec = repo.createAgent({ name: "executor-agent", provider: "cursor", role: "frontend" });
  const rev = repo.createAgent({ name: "reviewer-agent", provider: "cursor", role: "reviewer" });
  architectId = arch.id;
  executorId = exec.id;
  reviewerId = rev.id;

  const task = repo.createTask({ title: "Implement playbook feature", description: "Build the playbook service" });
  taskId = task.id;

  const sessResult = orchCreateSession({ title: "Playbook Test Session", architectId });
  sessionId = sessResult.session.id;
  orchAssignRole({ sessionId, agentId: executorId, role: "executor" });
  orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" });
});

afterAll(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Next Action: PLANNING phase ──

describe("pbGetNextAction — PLANNING", () => {
  it("architect gets plan-tasks when no assignments", () => {
    const result = pbGetNextAction({ sessionId, agentId: architectId });
    expect(result.sessionStatus).toBe("PLANNING");
    expect(result.actions[0].action).toBe("plan-tasks");
  });

  it("executor gets wait in PLANNING", () => {
    const result = pbGetNextAction({ sessionId, agentId: executorId });
    expect(result.actions[0].action).toBe("wait");
  });
});

// ── Next Action: EXECUTING phase ──

describe("pbGetNextAction — EXECUTING", () => {
  let assignmentId: string;

  it("architect gets advance-session after planning task", () => {
    const ta = orchPlanTask({ sessionId, taskId, assigneeAgentId: executorId });
    assignmentId = ta.id;
    const result = pbGetNextAction({ sessionId, agentId: architectId });
    expect(result.actions[0].action).toBe("advance-session");
  });

  it("executor gets accept-assignment after session advanced", () => {
    orchAdvanceSession(sessionId); // PLANNING → EXECUTING
    const result = pbGetNextAction({ sessionId, agentId: executorId });
    expect(result.actions[0].action).toBe("accept-assignment");
  });

  it("executor gets start-work after accepting", () => {
    orchAcceptAssignment(assignmentId);
    const result = pbGetNextAction({ sessionId, agentId: executorId });
    expect(result.actions[0].action).toBe("start-work");
  });

  it("executor gets checkpoint/complete after starting", () => {
    orchStartAssignment(assignmentId);
    const result = pbGetNextAction({ sessionId, agentId: executorId });
    const kinds = result.actions.map(a => a.action);
    expect(kinds).toContain("checkpoint");
    expect(kinds).toContain("complete-assignment");
  });

  it("architect gets request-review after all completed", () => {
    orchCompleteAssignment(assignmentId);
    const result = pbGetNextAction({ sessionId, agentId: architectId });
    expect(result.actions[0].action).toBe("request-review");
  });
});

// ── Next Action: REVIEWING phase ──

describe("pbGetNextAction — REVIEWING", () => {
  let reviewRequestId: string;

  it("reviewer gets start-review after review requested", () => {
    orchRequestReview({ sessionId, taskId, reviewerAgentId: reviewerId });
    orchAdvanceSession(sessionId); // EXECUTING → REVIEWING
    const result = pbGetNextAction({ sessionId, agentId: reviewerId });
    expect(result.actions[0].action).toBe("start-review");
  });

  it("reviewer gets add-checklist/add-evidence after starting review (no gate yet)", () => {
    const status = repo.listReviewRequests(sessionId);
    reviewRequestId = status[0].id;
    repo.updateReviewRequestStatus(reviewRequestId, "IN_PROGRESS" as any);
    const result = pbGetNextAction({ sessionId, agentId: reviewerId });
    const kinds = result.actions.map(a => a.action);
    expect(kinds).toContain("add-checklist");
    expect(kinds).toContain("add-evidence");
  });

  it("reviewer gets approve-review after gate PASSED", () => {
    const item = rwCreateChecklistItem({ reviewRequestId, title: "Build works" });
    rwUpdateChecklistItem(item.id, ChecklistItemStatus.PASSED);
    rwAddEvidence({ reviewRequestId, kind: "build", title: "pnpm build", content: "6 packages built" });

    const result = pbGetNextAction({ sessionId, agentId: reviewerId });
    expect(result.actions[0].action).toBe("approve-review");
  });
});

// ── Evidence Capture ──

describe("pbCaptureEvidence", () => {
  it("captures test output as evidence", () => {
    const reviews = repo.listReviewRequests(sessionId);
    const rrId = reviews[0].id;
    const result = pbCaptureEvidence({
      reviewRequestId: rrId,
      command: "pnpm test",
      output: "25 test files, 321 tests passed",
      exitCode: 0,
    });
    expect(result.kind).toBe("test");
    expect(result.evidence.content).toContain("321 tests");
    expect(result.evidence.metadataJson).toContain('"exitCode":0');
  });

  it("captures build output as evidence", () => {
    const reviews = repo.listReviewRequests(sessionId);
    const rrId = reviews[0].id;
    const result = pbCaptureEvidence({
      reviewRequestId: rrId,
      command: "pnpm build",
      output: "6 packages done",
    });
    expect(result.kind).toBe("build");
  });

  it("auto-detects lint kind", () => {
    const reviews = repo.listReviewRequests(sessionId);
    const rrId = reviews[0].id;
    const result = pbCaptureEvidence({
      reviewRequestId: rrId,
      command: "eslint src/",
      output: "No errors",
    });
    expect(result.kind).toBe("lint");
  });

  it("falls back to manual for unknown commands", () => {
    const reviews = repo.listReviewRequests(sessionId);
    const rrId = reviews[0].id;
    const result = pbCaptureEvidence({
      reviewRequestId: rrId,
      command: "cat README.md",
      output: "readme contents",
    });
    expect(result.kind).toBe("manual");
  });
});

// ── Active Session ──

describe("pbGetActiveSession", () => {
  it("returns active session for architect", () => {
    const result = pbGetActiveSession(architectId);
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe(sessionId);
    expect(result!.roles).toContain("architect");
    expect(result!.actions.length).toBeGreaterThan(0);
  });

  it("returns active session for executor", () => {
    const result = pbGetActiveSession(executorId);
    expect(result).not.toBeNull();
    expect(result!.agentName).toBe("executor-agent");
  });

  it("returns null for agent not in any session", () => {
    const lonely = repo.createAgent({ name: "lonely-agent", provider: "cursor", role: "other" });
    const result = pbGetActiveSession(lonely.id);
    expect(result).toBeNull();
  });
});

// ── P7 peer-contract claim → start-work transition ──

describe("peer-contract playbook claim → start-work", () => {
  let pcSessionId: string;
  let pcExecId: string;
  let pcArchId: string;
  let pcAssignmentId: string;
  let pcTaskId: string;

  beforeAll(() => {
    const arch = repo.createAgent({ name: "pc-arch", provider: "codex", role: "manager" });
    const exec = repo.createAgent({ name: "pc-exec", provider: "cursor", role: "backend" });
    pcArchId = arch.id;
    pcExecId = exec.id;

    const sess = orchCreateSession({
      title: "PC playbook test",
      createdBy: pcArchId,
      relationshipMode: "peer-contract",
    });
    pcSessionId = sess.session.id;
    orchAssignRole({ sessionId: pcSessionId, agentId: pcArchId, role: "architect" as any });
    orchAssignRole({ sessionId: pcSessionId, agentId: pcExecId, role: "executor" as any });

    const task = repo.createTask({ title: "PC playbook task", description: "" });
    pcTaskId = task.id;
    const ta = orchPlanTask({
      sessionId: pcSessionId,
      taskId: pcTaskId,
      assigneeAgentId: pcExecId,
      assignedBy: pcArchId,
    });
    pcAssignmentId = ta.id;
    orchAdvanceSession(pcSessionId);   // PLANNING → EXECUTING
    orchAcceptAssignment(pcAssignmentId);
  });

  it("before claim: playbook suggests claim-resources, not start-work", () => {
    const result = pbGetNextAction({ sessionId: pcSessionId, agentId: pcExecId });
    const kinds = result.actions.map(a => a.action);
    expect(kinds).toContain("claim-resources");
    expect(kinds).not.toContain("start-work");
  });

  it("after claim: playbook suggests start-work, not claim-resources", () => {
    rcClaim({
      actorId: pcExecId,
      taskId: pcTaskId,
      sessionId: pcSessionId,
      resources: [{ type: "file", locator: "src/feature.ts", metadata: "" }],
    });

    const result = pbGetNextAction({ sessionId: pcSessionId, agentId: pcExecId });
    const kinds = result.actions.map(a => a.action);
    expect(kinds).toContain("start-work");
    expect(kinds).not.toContain("claim-resources");
  });
});
