/**
 * CLI review command tests — Review workflow (checklist, evidence, gate, approve/block).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import {
  rwAddChecklistItem, rwUpdateChecklistItem,
  rwAddEvidence, rwEvaluateGate,
  rwApprove, rwBlock,
  rwRequestChange, rwAddressChange,
} from "syncpoint-server/application";
import {
  ChecklistItemStatus, EvidenceKind, ApprovalGateStatus,
  ChangeRequestStatus,
} from "syncpoint-governance";
import { ResourceNotFoundError } from "syncpoint-kernel";

let tmpDir: string;
let agentId: string;
let taskId: string;
let reviewRequestId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-review-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a = repo.createAgent({ name: "review-agent", provider: "cursor", role: "reviewer" });
  agentId = a.id;
  const t = repo.createTask({ title: "Review test task", description: "Task for review" });
  taskId = t.id;

  // Create session + assign + request review
  const session = repo.createSession({ title: "Review Session" });
  repo.assignRole(session.id, agentId, "executor", "");
  repo.assignTask(taskId, agentId);
  const rr = repo.requestReview(session.id, taskId, agentId, agentId, "full");
  reviewRequestId = rr.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("review checklist", () => {
  let itemId: string;

  it("adds a checklist item", () => {
    const item = rwAddChecklistItem({
      reviewRequestId,
      title: "Build passes",
      required: true,
    });
    expect(item.id).toBeTruthy();
    expect(item.title).toBe("Build passes");
    expect(item.status).toBe(ChecklistItemStatus.OPEN);
    expect(item.required).toBe(true);
    itemId = item.id;
  });

  it("updates checklist item status to PASSED", () => {
    const item = rwUpdateChecklistItem(itemId, {
      status: ChecklistItemStatus.PASSED,
      notes: "pnpm build succeeded",
    });
    expect(item.status).toBe(ChecklistItemStatus.PASSED);
  });
});

describe("review evidence", () => {
  it("adds evidence to review", () => {
    const evidence = rwAddEvidence({
      reviewRequestId,
      kind: EvidenceKind.BUILD,
      title: "CI build",
      content: "pnpm build: all packages compiled",
    });
    expect(evidence.id).toBeTruthy();
    expect(evidence.kind).toBe(EvidenceKind.BUILD);
    expect(evidence.content).toContain("all packages compiled");
  });

  it("adds test evidence", () => {
    const evidence = rwAddEvidence({
      reviewRequestId,
      kind: EvidenceKind.TEST,
      title: "Unit tests",
      content: "162 tests passed",
    });
    expect(evidence.kind).toBe(EvidenceKind.TEST);
  });
});

describe("review gate evaluation", () => {
  it("evaluates gate as PASSED when all required items pass", () => {
    // Need passed checklist + evidence; we added those in previous tests
    const result = rwEvaluateGate(reviewRequestId);
    expect(result.checklistTotal).toBeGreaterThanOrEqual(1);
    expect(result.checklistPassed).toBeGreaterThanOrEqual(1);
    expect(result.checklistFailed).toBe(0);
    expect(result.status).toBe(ApprovalGateStatus.PASSED);
  });
});

describe("review approve", () => {
  let approveReviewId: string;
  let approveTaskId: string;
  let approveAgentId: string;

  beforeAll(() => {
    const t = repo.createTask({ title: "Approve test task", description: "" });
    approveTaskId = t.id;
    const a = repo.createAgent({ name: "approve-agent", provider: "other", role: "reviewer" });
    approveAgentId = a.id;
    const session = repo.createSession({ title: "Approve Session" });
    repo.assignRole(session.id, approveAgentId, "executor", "");
    repo.assignTask(approveTaskId, approveAgentId);
    const rr = repo.requestReview(session.id, approveTaskId, approveAgentId, approveAgentId, "full");
    approveReviewId = rr.id;
    rwAddChecklistItem({ reviewRequestId: approveReviewId, title: "All good", required: true });
    // Pass the checklist
    const items = repo.listReviewChecklistItems(approveReviewId);
    for (const item of items) {
      rwUpdateChecklistItem(item.id, { status: ChecklistItemStatus.PASSED, notes: "ok" });
    }
  });

  it("approves a review", () => {
    const result = rwApprove(approveReviewId, "Looks good", approveAgentId);
    expect(result.approvalRecord.decision).toBe("approved");
    expect(result.approvalRecord.summary).toBe("Looks good");
  });

  it("blocked review cannot be approved twice", () => {
    // Create a fresh review and block it
    const t = repo.createTask({ title: "Block approve test", description: "" });
    const session = repo.createSession({ title: "Block Approve Session" });
    repo.assignRole(session.id, agentId, "executor", "");
    repo.assignTask(t.id, agentId);
    const rr = repo.requestReview(session.id, t.id, agentId, agentId, "full");
    rwBlock(rr.id, "Needs more work", "Add tests", agentId);
    // Attempting approve on blocked should fail
    expect(() => rwApprove(rr.id, "Forced", agentId)).toThrow();
  });
});

describe("review block and changes", () => {
  let blockReviewId: string;

  beforeAll(() => {
    const t = repo.createTask({ title: "Block/change test task", description: "" });
    const session = repo.createSession({ title: "Block Change Session" });
    repo.assignRole(session.id, agentId, "executor", "");
    repo.assignTask(t.id, agentId);
    const rr = repo.requestReview(session.id, t.id, agentId, agentId, "full");
    blockReviewId = rr.id;
  });

  it("blocks a review", () => {
    const result = rwBlock(blockReviewId, "Missing tests", "Add unit tests", agentId);
    expect(result.approvalRecord.decision).toBe("blocked");
    expect(result.approvalRecord.summary).toBe("Missing tests");
    expect(result.changeRequest).toBeDefined();
    expect(result.changeRequest.summary).toBe("Add unit tests");
  });

  it("creates a change request on block", () => {
    const changes = rwListChangeRequests(blockReviewId);
    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0]!.status).toBe(ChangeRequestStatus.OPEN);
  });

  it("addresses a change request", () => {
    const changes = rwListChangeRequests(blockReviewId);
    const crId = changes[0]!.id;
    const result = rwAddressChange(crId);
    expect(result.status).toBe(ChangeRequestStatus.ADDRESSED);
  });
});
