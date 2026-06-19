/**
 * Tests for review-workflow-service.ts — full review workflow tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchCompleteAssignment,
  orchRequestReview,
  orchStartReview,
} from "../../src/application/orchestration-service.js";
import {
  rwCreateChecklistItem,
  rwListChecklist,
  rwUpdateChecklistItem,
  rwAddEvidence,
  rwListEvidence,
  rwRequestChanges,
  rwAddressChange,
  rwListChangeRequests,
  rwEvaluateGate,
  rwApproveReview,
  rwBlockReview,
  rwWaiveGate,
  rwPrepareReviewPacket,
} from "../../src/application/review-workflow-service.js";
import { ChecklistItemStatus, ChangeRequestStatus, ApprovalGateStatus } from "syncpoint-governance";

let tmpDir: string;
let architectId: string;
let executorId: string;
let reviewerId: string;
let sessionId: string;
let taskId: string;
let reviewRequestId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rw-svc-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  defaultContext.db;

  const architect = repo.createAgent({ name: "architect-ai", provider: "claude-code", role: "manager" });
  const executor = repo.createAgent({ name: "exec-ai", provider: "codex", role: "backend" });
  const reviewer = repo.createAgent({ name: "review-ai", provider: "cursor", role: "reviewer" });
  architectId = architect.id;
  executorId = executor.id;
  reviewerId = reviewer.id;

  // Set up session with a completed task ready for review
  const sess = orchCreateSession({ title: "RW Test Session", architectId });
  sessionId = sess.session.id;
  orchAssignRole({ sessionId, agentId: executorId, role: "executor" });
  orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" });

  const task = repo.createTask({ title: "Implement auth module", description: "Auth feature" });
  taskId = task.id;
  const ta = orchPlanTask({ sessionId, taskId, assigneeAgentId: executorId, assignedBy: architectId });

  // Create checkpoint+snapshot for context
  repo.createCheckpoint({
    taskId,
    agentId: executorId,
    summary: "Auth module done",
    progress: "100%",
    currentUnderstanding: "",
    changedResources: ["auth.js"],
    risks: "",
    blockers: "",
    nextSteps: "Review",
    needSync: false,
  });

  orchAcceptAssignment(ta.id);
  orchStartAssignment(ta.id);
  orchCompleteAssignment(ta.id);

  const rr = orchRequestReview({ sessionId, taskId, reviewerAgentId: reviewerId, requestedBy: architectId });
  orchStartReview(rr.id);
  reviewRequestId = rr.id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Checklist", () => {
  let item1Id: string;
  let item2Id: string;

  it("create checklist items", () => {
    const item1 = rwCreateChecklistItem({ reviewRequestId, title: "Tests pass", required: true });
    const item2 = rwCreateChecklistItem({ reviewRequestId, title: "Build passes", required: true });
    const item3 = rwCreateChecklistItem({ reviewRequestId, title: "Code style", required: false });
    expect(item1.status).toBe(ChecklistItemStatus.OPEN);
    expect(item1.required).toBe(true);
    expect(item3.required).toBe(false);
    item1Id = item1.id;
    item2Id = item2.id;
  });

  it("list checklist items", () => {
    const items = rwListChecklist(reviewRequestId);
    expect(items.length).toBe(3);
  });

  it("pass a checklist item", () => {
    const updated = rwUpdateChecklistItem(item1Id, ChecklistItemStatus.PASSED, { notes: "262 tests OK", updatedBy: reviewerId });
    expect(updated.status).toBe(ChecklistItemStatus.PASSED);
    expect(updated.notes).toBe("262 tests OK");
  });

  it("fail a checklist item", () => {
    const updated = rwUpdateChecklistItem(item2Id, ChecklistItemStatus.FAILED, { notes: "Build error" });
    expect(updated.status).toBe(ChecklistItemStatus.FAILED);
  });

  it("re-open a failed item", () => {
    const updated = rwUpdateChecklistItem(item2Id, ChecklistItemStatus.OPEN);
    expect(updated.status).toBe(ChecklistItemStatus.OPEN);
  });

  it("pass the re-opened item", () => {
    const updated = rwUpdateChecklistItem(item2Id, ChecklistItemStatus.PASSED);
    expect(updated.status).toBe(ChecklistItemStatus.PASSED);
  });
});

describe("Evidence", () => {
  it("add evidence", () => {
    const ev = rwAddEvidence({
      reviewRequestId,
      kind: "test",
      title: "pnpm test",
      content: "23 test files, 262 tests passed",
      metadataJson: '{"command":"pnpm test","exitCode":0}',
      createdBy: reviewerId,
    });
    expect(ev.kind).toBe("test");
    expect(ev.content).toContain("262 tests");
  });

  it("add build evidence", () => {
    rwAddEvidence({
      reviewRequestId,
      kind: "build",
      title: "pnpm build",
      content: "6 packages built",
      createdBy: reviewerId,
    });
    const list = rwListEvidence(reviewRequestId);
    expect(list.length).toBe(2);
  });
});

describe("Approval gate", () => {
  it("gate is PASSED when required items have passed and evidence exists", () => {
    // item3 (non-required) is still OPEN, but required items are passed
    // Actually we need to check — 3 items: item1=PASSED, item2=PASSED, item3=OPEN(non-required)
    const gate = rwEvaluateGate(reviewRequestId);
    expect(gate.status).toBe(ApprovalGateStatus.PASSED);
    expect(gate.evidenceCount).toBe(2);
    expect(gate.openChangeRequests).toBe(0);
  });

  it("gate is BLOCKED when evidence is missing", () => {
    const task = repo.createTask({ title: "No evidence task", description: "" });
    const ta = orchPlanTask({ sessionId, taskId: task.id, assigneeAgentId: executorId });
    orchAcceptAssignment(ta.id);
    orchStartAssignment(ta.id);
    orchCompleteAssignment(ta.id);
    const rr = orchRequestReview({ sessionId, taskId: task.id, reviewerAgentId: reviewerId });

    const item = rwCreateChecklistItem({ reviewRequestId: rr.id, title: "Implementation reviewed" });
    rwUpdateChecklistItem(item.id, ChecklistItemStatus.PASSED);

    const gate = rwEvaluateGate(rr.id);
    expect(gate.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(gate.reasons).toContain("No review evidence recorded");
  });

  it("gate is BLOCKED when a required checklist item is open", () => {
    const task = repo.createTask({ title: "Open checklist task", description: "" });
    const ta = orchPlanTask({ sessionId, taskId: task.id, assigneeAgentId: executorId });
    orchAcceptAssignment(ta.id);
    orchStartAssignment(ta.id);
    orchCompleteAssignment(ta.id);
    const rr = orchRequestReview({ sessionId, taskId: task.id, reviewerAgentId: reviewerId });

    rwCreateChecklistItem({ reviewRequestId: rr.id, title: "Required review item" });
    rwAddEvidence({
      reviewRequestId: rr.id,
      kind: "manual",
      title: "Manual inspection",
      content: "Reviewer inspected the code.",
    });

    const gate = rwEvaluateGate(rr.id);
    expect(gate.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(gate.reasons).toContain("1 required checklist item(s) still OPEN");
  });
});

describe("Change requests", () => {
  let changeId: string;

  it("request changes blocks gate", () => {
    const cr = rwRequestChanges({
      reviewRequestId,
      summary: "Add error handling to auth.js",
      items: "1. Add try-catch\n2. Add input validation",
      requestedBy: reviewerId,
    });
    expect(cr.status).toBe(ChangeRequestStatus.OPEN);
    changeId = cr.id;

    const gate = rwEvaluateGate(reviewRequestId);
    expect(gate.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(gate.openChangeRequests).toBe(1);
  });

  it("address change request clears block", () => {
    const addressed = rwAddressChange({ changeRequestId: changeId, addressedBy: executorId });
    expect(addressed.status).toBe(ChangeRequestStatus.ADDRESSED);

    const gate = rwEvaluateGate(reviewRequestId);
    expect(gate.status).toBe(ApprovalGateStatus.PASSED);
    expect(gate.openChangeRequests).toBe(0);
  });

  it("list change requests", () => {
    const list = rwListChangeRequests(reviewRequestId);
    expect(list.length).toBe(1);
    expect(list[0]!.status).toBe(ChangeRequestStatus.ADDRESSED);
  });
});

describe("Approve review", () => {
  it("approve when gate is PASSED", () => {
    const result = rwApproveReview({ reviewRequestId, summary: "LGTM. All checks pass.", decidedBy: reviewerId });
    expect(result.approvalRecord.decision).toBe("approved");
    expect(result.gate.status).toBe(ApprovalGateStatus.PASSED);
    expect(result.reviewDecision.verdict).toBe("approved");
    expect(result.reviewRequest.status).toBe("DECIDED");
  });
});

describe("Block review flow", () => {
  let rr2Id: string;

  beforeAll(() => {
    // Create another task+review for block test
    const task2 = repo.createTask({ title: "Second task", description: "" });
    const ta2 = orchPlanTask({ sessionId, taskId: task2.id, assigneeAgentId: executorId });
    orchAcceptAssignment(ta2.id);
    orchStartAssignment(ta2.id);
    orchCompleteAssignment(ta2.id);
    const rr2 = orchRequestReview({ sessionId, taskId: task2.id, reviewerAgentId: reviewerId });
    orchStartReview(rr2.id);
    rr2Id = rr2.id;
  });

  it("block review creates record + change request", () => {
    const result = rwBlockReview({
      reviewRequestId: rr2Id,
      summary: "Missing tests",
      requestedChanges: "Add unit tests for all public functions",
      decidedBy: reviewerId,
    });
    expect(result.approvalRecord.decision).toBe("blocked");
    expect(result.reviewDecision.verdict).toBe("request-changes");
    expect(result.reviewRequest.status).toBe("DECIDED");
    expect(result.changeRequest).toBeDefined();
    expect(result.changeRequest!.summary).toContain("Add unit tests");
  });

  it("gate is BLOCKED due to open change request", () => {
    const gate = rwEvaluateGate(rr2Id);
    expect(gate.status).toBe(ApprovalGateStatus.BLOCKED);
  });

  it("cannot approve when gate is BLOCKED", () => {
    expect(() => rwApproveReview({ reviewRequestId: rr2Id, summary: "try approve" }))
      .toThrow("Cannot approve: gate is BLOCKED");
  });

  it("waive gate creates waiver record", () => {
    const record = rwWaiveGate({ reviewRequestId: rr2Id, reason: "Deadline exception", decidedBy: "owner" });
    expect(record.decision).toBe("waived");
    expect(record.waiverReason).toBe("Deadline exception");
  });
});

describe("Review packet", () => {
  it("prepare full review packet", () => {
    const packet = rwPrepareReviewPacket(reviewRequestId);
    expect(packet.reviewRequest.id).toBe(reviewRequestId);
    expect(packet.checklistItems.length).toBe(3);
    expect(packet.evidence.length).toBe(2);
    expect(packet.changeRequests.length).toBe(1);
    expect(packet.approvalRecords.length).toBe(1);
    expect(packet.gate.status).toBe(ApprovalGateStatus.PASSED);
    expect(packet.context).toBeDefined();
    expect(packet.context!.intent).toBe("review");
  });
});
