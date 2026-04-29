/**
 * Integration tests for SyncGate Service — synchronization barriers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import {
  sgRequest, sgAck, sgResolve, sgCancel,
  sgStatus, sgList, sgListActive, sgCheckAgent,
} from "./sync-gate-service.js";
import { orchCreateSession, orchAssignRole, orchPlanTask, orchAcceptAssignment, orchStartAssignment } from "./orchestration-service.js";
import { loopResume } from "./loop-service.js";
import { wakeNext, wakeStart } from "./wake-engine-service.js";
import { SyncGateStatus, TaskStatus, WakeRequestStatus } from "syncpoint-core";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let agent3Id: string;
let task1Id: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-sg-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const a1 = repo.createAgent({ name: "arch", provider: "codex", role: "manager" });
  const a2 = repo.createAgent({ name: "exec-a", provider: "cursor", role: "backend" });
  const a3 = repo.createAgent({ name: "exec-b", provider: "claude-code", role: "backend" });
  agent1Id = a1.id;
  agent2Id = a2.id;
  agent3Id = a3.id;

  const t1 = repo.createTask({ title: "Auth module", description: "" });
  task1Id = t1.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SyncGate full lifecycle", () => {
  let gateId: string;

  it("creates a sync gate in SYNC_REQUESTED state", () => {
    const result = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id, agent3Id],
      reason: "file_conflict",
      description: "Both agents claim src/auth.ts",
      relatedFiles: "src/auth.ts",
    });

    expect(result.gate.status).toBe(SyncGateStatus.SYNC_REQUESTED);
    expect(result.pending).toEqual([agent2Id, agent3Id]);
    expect(result.isBlocking).toBe(true);
    expect(result.allAcknowledged).toBe(false);
    gateId = result.gate.id;
  });

  it("agents are blocked before acknowledging", () => {
    const check2 = sgCheckAgent(agent2Id, { taskId: task1Id });
    expect(check2.blocked).toBe(true);
    expect(check2.blockingGates).toHaveLength(1);

    const check3 = sgCheckAgent(agent3Id, { taskId: task1Id });
    expect(check3.blocked).toBe(true);
  });

  it("non-required agent is not blocked", () => {
    const check1 = sgCheckAgent(agent1Id, { taskId: task1Id });
    expect(check1.blocked).toBe(false);
  });

  it("first agent acknowledges — gate still blocking", () => {
    const result = sgAck(gateId, agent2Id, "I will use a different approach");
    expect(result.pending).toEqual([agent3Id]);
    expect(result.allAcknowledged).toBe(false);
    expect(result.gate.status).toBe(SyncGateStatus.SYNC_REQUESTED);
    expect(result.isBlocking).toBe(true);
  });

  it("first agent remains blocked after acking until the gate resolves", () => {
    const check2 = sgCheckAgent(agent2Id, { taskId: task1Id });
    expect(check2.blocked).toBe(true);
  });

  it("second agent acknowledges — gate auto-advances to SYNC_ACKED", () => {
    const result = sgAck(gateId, agent3Id, "Acknowledged");
    expect(result.pending).toEqual([]);
    expect(result.allAcknowledged).toBe(true);
    expect(result.gate.status).toBe(SyncGateStatus.SYNC_ACKED);
    expect(result.isBlocking).toBe(true);
  });

  it("agents remain blocked after all acked until READY_TO_CONTINUE", () => {
    const check2 = sgCheckAgent(agent2Id, { taskId: task1Id });
    const check3 = sgCheckAgent(agent3Id, { taskId: task1Id });
    expect(check2.blocked).toBe(true);
    expect(check3.blocked).toBe(true);
  });

  it("resolves the gate → READY_TO_CONTINUE", () => {
    const result = sgResolve(gateId, "Agents agreed to split file ownership");
    expect(result.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
    expect(result.isBlocking).toBe(false);
    expect(sgCheckAgent(agent2Id, { taskId: task1Id }).blocked).toBe(false);
    expect(sgCheckAgent(agent3Id, { taskId: task1Id }).blocked).toBe(false);
  });

  it("sgStatus returns full info", () => {
    const result = sgStatus(gateId);
    expect(result.gate.decisionSummary).toBe("Agents agreed to split file ownership");
    expect(result.allAcknowledged).toBe(true);
  });
});

describe("SyncGate cancel", () => {
  it("can cancel an active gate", () => {
    const result = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
      reason: "manual_request",
      description: "Cancelled test",
    });

    const cancelled = sgCancel(result.gate.id, "No longer needed");
    expect(cancelled.status).toBe(SyncGateStatus.CANCELLED);
  });
});

describe("SyncGate listing", () => {
  it("sgList returns all gates", () => {
    const gates = sgList({ taskId: task1Id });
    expect(gates.length).toBeGreaterThanOrEqual(2);
  });

  it("sgListActive excludes resolved and cancelled gates", () => {
    const active = sgListActive({ taskId: task1Id });
    for (const g of active) {
      expect([
        SyncGateStatus.NEEDS_SYNC,
        SyncGateStatus.SYNC_REQUESTED,
        SyncGateStatus.SYNC_ACKED,
      ]).toContain(g.status);
    }
  });
});

describe("SyncGate error cases", () => {
  it("rejects ack from non-required agent", () => {
    const result = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
    });
    expect(() => sgAck(result.gate.id, agent3Id)).toThrow("not required");
  });

  it("rejects resolve from wrong state", () => {
    const result = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
    });
    // SYNC_REQUESTED → READY_TO_CONTINUE is not valid (must go through SYNC_ACKED)
    expect(() => sgResolve(result.gate.id)).toThrow("Cannot resolve");
  });
});

describe("SyncGate events logged", () => {
  it("SYNC_GATE_CREATED events appear in event log", () => {
    const events = repo.listEvents(100);
    const gateEvents = events.filter(e => e.eventType === "SYNC_GATE_CREATED");
    expect(gateEvents.length).toBeGreaterThan(0);
  });

  it("SYNC_GATE_ACKED events appear in event log", () => {
    const events = repo.listEvents(100);
    const ackEvents = events.filter(e => e.eventType === "SYNC_GATE_ACKED");
    expect(ackEvents.length).toBeGreaterThan(0);
  });
});

describe("sgList multi-filter regression", () => {
  let sessionGateId: string;

  it("creates gates with session context for filtering", () => {
    const r = sgRequest({
      sessionId: "sess-filter-test",
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
      reason: "manual_request",
    });
    sessionGateId = r.gate.id;
  });

  it("sgList filters by taskId + status correctly", () => {
    const gates = sgList({ taskId: task1Id, status: SyncGateStatus.SYNC_REQUESTED });
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) {
      expect(g.taskId).toBe(task1Id);
      expect(g.status).toBe(SyncGateStatus.SYNC_REQUESTED);
    }
  });

  it("sgList filters by sessionId + status correctly", () => {
    const gates = sgList({ sessionId: "sess-filter-test", status: SyncGateStatus.SYNC_REQUESTED });
    expect(gates).toHaveLength(1);
    expect(gates[0].id).toBe(sessionGateId);
  });

  it("sgList filters by all three fields", () => {
    const gates = sgList({ taskId: task1Id, sessionId: "sess-filter-test", status: SyncGateStatus.SYNC_REQUESTED });
    expect(gates).toHaveLength(1);

    // Non-matching combination returns empty
    const empty = sgList({ taskId: task1Id, sessionId: "nonexistent", status: SyncGateStatus.SYNC_REQUESTED });
    expect(empty).toHaveLength(0);
  });
});

describe("SyncGate hard gate enforcement", () => {
  let sessionId: string;
  let task2Id: string;
  let assignmentId: string;
  let gateId: string;

  it("setup: create session, assignment, and gate", () => {
    const task2 = repo.createTask({ title: "Blocked work", description: "" });
    task2Id = task2.id;

    const result = orchCreateSession({ title: "Hard gate test", createdBy: agent1Id });
    sessionId = result.session.id;
    orchAssignRole({ sessionId, agentId: agent1Id, role: "architect" as any });
    orchAssignRole({ sessionId, agentId: agent2Id, role: "executor" as any });

    const assignment = orchPlanTask({
      sessionId,
      taskId: task2Id,
      assigneeAgentId: agent2Id,
      assignedBy: agent1Id,
    });
    assignmentId = assignment.id;
    orchAcceptAssignment(assignmentId);

    // Create a blocking gate on agent2 for this task
    const r = sgRequest({
      sessionId,
      taskId: task2Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
      reason: "file_conflict",
      description: "Hard gate test",
    });
    gateId = r.gate.id;
  });

  it("orchStartAssignment throws when agent is blocked by gate", () => {
    expect(() => orchStartAssignment(assignmentId)).toThrow(/sync gate/i);
  });

  it("loopResume throws when agent is blocked by gate", () => {
    // Ensure task is in a resumable state
    try { repo.updateTaskStatus(task2Id, TaskStatus.IN_PROGRESS); } catch { /* ignore */ }
    expect(() => loopResume({ agentId: agent2Id, taskId: task2Id })).toThrow(/sync gate/i);
  });

  it("after ack + resolve, orchStartAssignment succeeds", () => {
    sgAck(gateId, agent2Id, "acknowledged");
    sgResolve(gateId, "resolved");
    const ta = orchStartAssignment(assignmentId);
    expect(ta.status).toBe("IN_PROGRESS");
  });
});

describe("Wake hard-gate enforcement", () => {
  let wakeSessionId: string;
  let wakeGateId: string;
  let wakeReqId: string;

  it("setup: create session, wake request, and blocking gate", () => {
    const task3 = repo.createTask({ title: "Wake gate task", description: "" });
    const sess = orchCreateSession({ title: "Wake gate session", createdBy: agent1Id });
    wakeSessionId = sess.session.id;
    orchAssignRole({ sessionId: wakeSessionId, agentId: agent1Id, role: "architect" as any });
    orchAssignRole({ sessionId: wakeSessionId, agentId: agent2Id, role: "executor" as any });

    // Create a wake request for agent2
    wakeReqId = repo.createWakeRequest({
      sessionId: wakeSessionId,
      targetAgentId: agent2Id,
      targetRole: "executor",
      action: "accept-assignment",
      reason: "test wake gate",
      runnerMode: "manual",
      triggerEventType: "TEST",
      triggerEntityId: task3.id,
      taskId: null,
      reviewRequestId: null,
      promptHint: "",
      mcpToolHint: "",
      cliHint: "",
    }).id;

    // Create a blocking gate on agent2
    const r = sgRequest({
      sessionId: wakeSessionId,
      taskId: task3.id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
      reason: "phase_transition",
      description: "Block wake test",
    });
    wakeGateId = r.gate.id;
  });

  it("wakeNext returns null when agent is blocked", () => {
    const result = wakeNext(agent2Id);
    expect(result).toBeNull();
  });

  it("wakeStart throws when agent is blocked by gate", () => {
    // Dispatch (QUEUED → DISPATCHED) so we can attempt start
    repo.updateWakeRequestStatus(wakeReqId, WakeRequestStatus.DISPATCHED);
    expect(() => wakeStart(wakeReqId)).toThrow(/sync gate/i);
    // wakeStart threw before transitioning, so status is still DISPATCHED
  });

  it("after ack + resolve, wakeStart succeeds", () => {
    // Ack and resolve the wake gate; SYNC_ACKED still blocks until resolved.
    sgAck(wakeGateId, agent2Id, "acked");
    sgResolve(wakeGateId, "resolved");

    // Cancel any other active gates from prior tests that still block agent2
    const remaining = sgListActive();
    for (const g of remaining) {
      try { sgCancel(g.id, "cleanup"); } catch { /* already resolved/cancelled */ }
    }

    // Wake is still DISPATCHED from previous test — start should now succeed
    const result = wakeStart(wakeReqId);
    expect(result.status).toBe(WakeRequestStatus.RUNNING);
  });

  it("wakeNext returns queued requests when unblocked", () => {
    const task4 = repo.createTask({ title: "Wake gate task 2", description: "" });
    const wr2 = repo.createWakeRequest({
      sessionId: wakeSessionId,
      targetAgentId: agent2Id,
      targetRole: "executor",
      action: "accept-assignment",
      reason: "test unblocked wake",
      runnerMode: "manual",
      triggerEventType: "TEST",
      triggerEntityId: task4.id,
      taskId: null,
      reviewRequestId: null,
      promptHint: "",
      mcpToolHint: "",
      cliHint: "",
    });
    const result = wakeNext(agent2Id);
    expect(result).not.toBeNull();
    // May return any queued request for agent2; the key assertion is non-null (unblocked)
  });
});
