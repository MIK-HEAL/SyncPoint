/**
 * Tests for orchestration-service.ts — full workflow tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchCompleteAssignment,
  orchRequestReview,
  orchStartReview,
  orchSubmitReview,
  orchGetSessionStatus,
  orchAdvanceSession,
  orchCancelSession,
} from "./orchestration-service.js";
import { SessionStatus, TaskAssignmentStatus, ReviewRequestStatus } from "syncpoint-core";

let tmpDir: string;
let architectId: string;
let executorId: string;
let reviewerId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-orch-svc-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const architect = repo.createAgent({ name: "architect-ai", provider: "claude-code", role: "manager" });
  const executor = repo.createAgent({ name: "exec-ai", provider: "codex", role: "backend" });
  const reviewer = repo.createAgent({ name: "review-ai", provider: "cursor", role: "reviewer" });
  architectId = architect.id;
  executorId = executor.id;
  reviewerId = reviewer.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Session lifecycle", () => {
  let sessionId: string;
  let taskId: string;
  let assignmentId: string;
  let reviewRequestId: string;

  it("create session with architect", () => {
    const result = orchCreateSession({
      title: "Sprint 1",
      description: "First orchestration sprint",
      architectId,
      createdBy: "user",
    });
    expect(result.ok).toBe(true);
    expect(result.session.title).toBe("Sprint 1");
    expect(result.session.status).toBe(SessionStatus.PLANNING);
    expect(result.architectRole).toBeDefined();
    expect(result.architectRole!.role).toBe("architect");
    sessionId = result.session.id;
  });

  it("assign executor and reviewer roles", () => {
    const execRole = orchAssignRole({ sessionId, agentId: executorId, role: "executor" });
    expect(execRole.role).toBe("executor");

    const revRole = orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" });
    expect(revRole.role).toBe("reviewer");
  });

  it("plan a task", () => {
    const task = repo.createTask({ title: "Implement auth module", description: "Auth feature" });
    taskId = task.id;
    const assignment = orchPlanTask({
      sessionId,
      taskId,
      assigneeAgentId: executorId,
      assignedBy: architectId,
      notes: "Use JWT-based auth",
    });
    expect(assignment.status).toBe(TaskAssignmentStatus.PROPOSED);
    expect(assignment.notes).toBe("Use JWT-based auth");
    assignmentId = assignment.id;
  });

  it("rejects planning a task already owned by another agent", () => {
    const otherTask = repo.createTask({ title: "Already owned task", description: "" });
    repo.assignTask(otherTask.id, reviewerId);

    expect(() => orchPlanTask({
      sessionId,
      taskId: otherTask.id,
      assigneeAgentId: executorId,
      assignedBy: architectId,
    })).toThrow("already assigned");
  });

  it("advance session PLANNING → EXECUTING", () => {
    const result = orchAdvanceSession(sessionId);
    expect(result.transitioned).toBe(true);
    expect(result.session.status).toBe(SessionStatus.EXECUTING);
  });

  it("executor accepts assignment", () => {
    const ta = orchAcceptAssignment(assignmentId);
    expect(ta.status).toBe(TaskAssignmentStatus.ACCEPTED);
  });

  it("executor starts work", () => {
    const ta = orchStartAssignment(assignmentId);
    expect(ta.status).toBe(TaskAssignmentStatus.IN_PROGRESS);
  });

  it("executor completes assignment", () => {
    const ta = orchCompleteAssignment(assignmentId);
    expect(ta.status).toBe(TaskAssignmentStatus.COMPLETED);
  });

  it("advance session EXECUTING → REVIEWING", () => {
    const result = orchAdvanceSession(sessionId);
    expect(result.transitioned).toBe(true);
    expect(result.session.status).toBe(SessionStatus.REVIEWING);
  });

  it("request review", () => {
    const rr = orchRequestReview({
      sessionId,
      taskId,
      reviewerAgentId: reviewerId,
      requestedBy: architectId,
      scope: "code review + tests",
    });
    expect(rr.status).toBe(ReviewRequestStatus.PENDING);
    reviewRequestId = rr.id;
  });

  it("reviewer starts review", () => {
    const rr = orchStartReview(reviewRequestId);
    expect(rr.status).toBe(ReviewRequestStatus.IN_PROGRESS);
  });

  it("reviewer approves", () => {
    const result = orchSubmitReview({
      reviewRequestId,
      verdict: "approved",
      summary: "Code quality is good. All tests pass.",
      decidedBy: reviewerId,
    });
    expect(result.decision.verdict).toBe("approved");
    expect(result.reviewRequest.status).toBe(ReviewRequestStatus.DECIDED);
  });

  it("advance session REVIEWING → COMPLETED", () => {
    const result = orchAdvanceSession(sessionId);
    expect(result.transitioned).toBe(true);
    expect(result.session.status).toBe(SessionStatus.COMPLETED);
  });

  it("get full session status", () => {
    const status = orchGetSessionStatus(sessionId);
    expect(status.session.status).toBe(SessionStatus.COMPLETED);
    expect(status.roles.length).toBe(3);
    expect(status.assignments.length).toBe(1);
    expect(status.reviews.length).toBe(1);
    expect(status.decisions.length).toBe(1);
    expect(status.decisions[0].verdict).toBe("approved");
  });
});

describe("Review request boundaries", () => {
  it("rejects review requests for tasks not assigned in the session", () => {
    const result = orchCreateSession({ title: "Sprint boundary", architectId });
    const task = repo.createTask({ title: "Outside task", description: "" });

    expect(() => orchRequestReview({
      sessionId: result.session.id,
      taskId: task.id,
      reviewerAgentId: reviewerId,
    })).toThrow("not assigned in session");
  });
});

describe("Review request-changes flow", () => {
  let sessionId: string;
  let taskId: string;
  let assignmentId: string;

  it("setup session with task", () => {
    const result = orchCreateSession({ title: "Sprint 2", architectId });
    sessionId = result.session.id;
    orchAssignRole({ sessionId, agentId: executorId, role: "executor" });
    orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" });

    const task = repo.createTask({ title: "Implement caching", description: "Cache layer" });
    taskId = task.id;
    const ta = orchPlanTask({ sessionId, taskId, assigneeAgentId: executorId });
    assignmentId = ta.id;

    orchAdvanceSession(sessionId); // → EXECUTING
    orchAcceptAssignment(assignmentId);
    orchStartAssignment(assignmentId);
    orchCompleteAssignment(assignmentId);
    orchAdvanceSession(sessionId); // → REVIEWING
  });

  it("reviewer requests changes → back to EXECUTING", () => {
    const rr = orchRequestReview({ sessionId, taskId, reviewerAgentId: reviewerId });
    orchStartReview(rr.id);
    orchSubmitReview({
      reviewRequestId: rr.id,
      verdict: "request-changes",
      summary: "Need better error handling",
      requestedChanges: "Add try-catch to all async functions",
      decidedBy: reviewerId,
    });

    const result = orchAdvanceSession(sessionId);
    expect(result.transitioned).toBe(true);
    expect(result.session.status).toBe(SessionStatus.EXECUTING);
    expect(result.reason).toContain("not approved");
  });
});

describe("Cancel session", () => {
  it("can cancel a session in any active state", () => {
    const result = orchCreateSession({ title: "Sprint 3" });
    const cancelled = orchCancelSession(result.session.id);
    expect(cancelled.status).toBe(SessionStatus.CANCELLED);
  });
});

describe("No transition when conditions not met", () => {
  it("no advance from EXECUTING when assignments not complete", () => {
    const result = orchCreateSession({ title: "Sprint 4", architectId });
    const task = repo.createTask({ title: "Incomplete task", description: "" });
    orchPlanTask({ sessionId: result.session.id, taskId: task.id, assigneeAgentId: executorId });
    orchAdvanceSession(result.session.id); // → EXECUTING

    const advance = orchAdvanceSession(result.session.id);
    expect(advance.transitioned).toBe(false);
    expect(advance.reason).toContain("No transition");
  });

  it("no advance from REVIEWING when reviews not decided", () => {
    const sess = orchCreateSession({ title: "Sprint 5", architectId });
    const task = repo.createTask({ title: "Need review", description: "" });
    const ta = orchPlanTask({ sessionId: sess.session.id, taskId: task.id, assigneeAgentId: executorId });
    orchAdvanceSession(sess.session.id); // → EXECUTING
    orchAcceptAssignment(ta.id);
    orchStartAssignment(ta.id);
    orchCompleteAssignment(ta.id);
    orchAdvanceSession(sess.session.id); // → REVIEWING

    orchRequestReview({ sessionId: sess.session.id, taskId: task.id, reviewerAgentId: reviewerId });

    const advance = orchAdvanceSession(sess.session.id);
    expect(advance.transitioned).toBe(false);
  });
});
