/**
 * Integration tests for Wake Engine Service.
 * Verifies that orchestration events automatically create WakeRequests.
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
  orchStartReview,
  orchSubmitReview,
  orchAdvanceSession,
} from "./orchestration-service.js";
import {
  wakeEngineStart,
  wakeEngineStop,
  wakeEngineStats,
  wakeList,
  wakeNext,
  wakeAck,
  wakeStart,
  wakeDone,
} from "./wake-engine-service.js";
import { SessionStatus } from "syncpoint-adapters";
import { WakeRequestStatus } from "syncpoint-governance";

let tmpDir: string;
let architectId: string;
let executorId: string;
let reviewerId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-wake-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const architect = repo.createAgent({ name: "arch-ai", provider: "claude-code", role: "manager" });
  const executor = repo.createAgent({ name: "exec-ai", provider: "codex", role: "backend" });
  const reviewer = repo.createAgent({ name: "rev-ai", provider: "cursor", role: "reviewer" });
  architectId = architect.id;
  executorId = executor.id;
  reviewerId = reviewer.id;

  // Start wake engine
  wakeEngineStart();
});

afterAll(() => {
  wakeEngineStop();
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Wake Engine — full session lifecycle", () => {
  let sessionId: string;
  let taskId: string;
  let assignmentId: string;

  it("SESSION_CREATED → wakes architect to plan-tasks", () => {
    const result = orchCreateSession({
      title: "Wake Test Sprint",
      architectId,
      createdBy: "user",
    });
    sessionId = result.session.id;

    // Assign other roles so wake rules can match them
    orchAssignRole({ sessionId, agentId: executorId, role: "executor" });
    orchAssignRole({ sessionId, agentId: reviewerId, role: "reviewer" });

    // Check wake requests
    const wakes = wakeList({ sessionId });
    const archWake = wakes.find(w => w.targetAgentId === architectId && w.action === "plan-tasks");
    expect(archWake).toBeDefined();
    expect(archWake!.status).toBe(WakeRequestStatus.QUEUED);
    expect(archWake!.promptHint).toBeTruthy();
    expect(archWake!.mcpToolHint).toBeTruthy();
    expect(archWake!.cliHint).toBeTruthy();
  });

  it("architect acknowledges and completes the plan-tasks wake", () => {
    const wake = wakeNext(architectId);
    expect(wake).not.toBeNull();
    expect(wake!.action).toBe("plan-tasks");

    const acked = wakeAck(wake!.id);
    expect(acked.status).toBe(WakeRequestStatus.DISPATCHED);

    const started = wakeStart(wake!.id);
    expect(started.status).toBe(WakeRequestStatus.RUNNING);

    const done = wakeDone(wake!.id, "Planned 1 task");
    expect(done.status).toBe(WakeRequestStatus.DONE);
  });

  it("ASSIGNMENT_CREATED → wakes executor to accept-assignment", () => {
    const task = repo.createTask({ title: "Build API endpoints", description: "" });
    taskId = task.id;
    const assignment = orchPlanTask({
      sessionId,
      taskId,
      assigneeAgentId: executorId,
      assignedBy: architectId,
    });
    assignmentId = assignment.id;

    const wakes = wakeList({ sessionId, status: WakeRequestStatus.QUEUED });
    const execWake = wakes.find(w => w.targetAgentId === executorId && w.action === "accept-assignment");
    expect(execWake).toBeDefined();
  });

  it("advance PLANNING → EXECUTING also wakes executor", () => {
    orchAdvanceSession(sessionId);
    // SESSION_ADVANCED to EXECUTING should create another wake for executor
    const wakes = wakeList({ sessionId, status: WakeRequestStatus.QUEUED });
    const execWakes = wakes.filter(w => w.targetAgentId === executorId);
    // At least one queued wake for executor
    expect(execWakes.length).toBeGreaterThanOrEqual(1);
  });

  it("ASSIGNMENT_COMPLETED → wakes architect to request-review", () => {
    orchAcceptAssignment(assignmentId);
    orchStartAssignment(assignmentId);
    orchCompleteAssignment(assignmentId);

    const wakes = wakeList({ sessionId, status: WakeRequestStatus.QUEUED });
    const archWake = wakes.find(w => w.targetAgentId === architectId && w.action === "request-review");
    expect(archWake).toBeDefined();
    expect(archWake!.triggerEventType).toBe("ASSIGNMENT_COMPLETED");
  });

  it("advance EXECUTING → REVIEWING", () => {
    orchAdvanceSession(sessionId);
    const session = repo.getSession(sessionId);
    expect(session.status).toBe(SessionStatus.REVIEWING);
  });

  it("REVIEW_REQUESTED → wakes reviewer to start-review", () => {
    const rr = orchRequestReview({
      sessionId,
      taskId,
      reviewerAgentId: reviewerId,
      requestedBy: architectId,
    });

    const wakes = wakeList({ sessionId, status: WakeRequestStatus.QUEUED });
    const revWake = wakes.find(w => w.targetAgentId === reviewerId && w.action === "start-review");
    expect(revWake).toBeDefined();
    expect(revWake!.reviewRequestId).toBe(rr.id);
  });

  it("REVIEW_APPROVED → wakes architect to advance-session", () => {
    const reviews = repo.listReviewRequests(sessionId);
    const rr = reviews[0]!;
    orchStartReview(rr.id);
    orchSubmitReview({
      reviewRequestId: rr.id,
      verdict: "approved",
      summary: "Looks good!",
      decidedBy: reviewerId,
    });

    const wakes = wakeList({ sessionId, status: WakeRequestStatus.QUEUED });
    const archWake = wakes.find(w => w.targetAgentId === architectId && w.action === "advance-session");
    expect(archWake).toBeDefined();
  });

  it("advance REVIEWING → COMPLETED", () => {
    orchAdvanceSession(sessionId);
    const session = repo.getSession(sessionId);
    expect(session.status).toBe(SessionStatus.COMPLETED);
  });

  it("engine stats reflect processing", () => {
    const stats = wakeEngineStats();
    expect(stats.running).toBe(true);
    expect(stats.eventsProcessed).toBeGreaterThan(0);
    expect(stats.wakeRequestsCreated).toBeGreaterThan(0);
  });
});

describe("Wake Engine — deduplication", () => {
  it("does not create duplicate QUEUED wakes for same agent + action", () => {
    const result = orchCreateSession({ title: "Dedup Test", architectId });
    orchAssignRole({ sessionId: result.session.id, agentId: executorId, role: "executor" });

    const task = repo.createTask({ title: "Task A", description: "" });
    orchPlanTask({ sessionId: result.session.id, taskId: task.id, assigneeAgentId: executorId });

    const task2 = repo.createTask({ title: "Task B", description: "" });
    orchPlanTask({ sessionId: result.session.id, taskId: task2.id, assigneeAgentId: executorId });

    // Should only have one QUEUED accept-assignment wake for executor (deduped)
    const wakes = wakeList({ sessionId: result.session.id, status: WakeRequestStatus.QUEUED });
    const execAcceptWakes = wakes.filter(
      w => w.targetAgentId === executorId && w.action === "accept-assignment"
    );
    expect(execAcceptWakes.length).toBe(1);
  });
});

describe("Wake Engine — agent polling", () => {
  it("wakeNext returns null when no queued wakes", () => {
    const dummy = repo.createAgent({ name: "dummy", provider: "other", role: "other" });
    const result = wakeNext(dummy.id);
    expect(result).toBeNull();
  });
});

describe("Wake Engine — inline path (no wakeEngineStart)", () => {
  it("creates wakes via orchEvent even when EventBus listener is stopped", () => {
    // Stop the EventBus listener — simulates MCP/CLI entry point
    wakeEngineStop();

    const arch2 = repo.createAgent({ name: "arch2", provider: "claude-code", role: "manager" });
    const exec2 = repo.createAgent({ name: "exec2", provider: "codex", role: "backend" });

    const result = orchCreateSession({ title: "Inline Wake Test", architectId: arch2.id });
    orchAssignRole({ sessionId: result.session.id, agentId: exec2.id, role: "executor" });

    // Even without wakeEngineStart(), wakes should be created by the inline orchEvent() call
    const wakes = wakeList({ sessionId: result.session.id });
    const archWake = wakes.find(w => w.targetAgentId === arch2.id && w.action === "plan-tasks");
    expect(archWake).toBeDefined();
    expect(archWake!.status).toBe(WakeRequestStatus.QUEUED);

    // Restart engine for other tests
    wakeEngineStart();
  });

  it("WAKE_CREATED events are written to event log", () => {
    const arch3 = repo.createAgent({ name: "arch3", provider: "claude-code", role: "manager" });
    const result = orchCreateSession({ title: "SSE Wake Test", architectId: arch3.id });

    // Check that WAKE_CREATED events exist in the event log
    const events = repo.listEvents(100);
    const wakeEvents = events.filter(e => e.eventType === "WAKE_CREATED");
    expect(wakeEvents.length).toBeGreaterThan(0);

    // Find the event matching this session (listEvents is DESC, so filter by sessionId in detail)
    const matching = wakeEvents.find(e => {
      const d = JSON.parse(e.detail);
      return d.sessionId === result.session.id;
    });
    expect(matching).toBeDefined();
    const detail = JSON.parse(matching!.detail);
    expect(detail.action).toBe("plan-tasks");
  });
});
