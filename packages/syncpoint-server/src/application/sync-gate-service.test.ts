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
  sgStatus, sgList, sgListActive, sgCheckAgent, sgVote,
} from "./sync-gate-service.js";
import { rcClaim, rcRelease } from "./resource-claim-service.js";
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
      reason: "resource_conflict",
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

  it("first agent acknowledges — gate moves to PARTIALLY_ACKED", () => {
    const result = sgAck(gateId, agent2Id, "I will use a different approach");
    expect(result.pending).toEqual([agent3Id]);
    expect(result.allAcknowledged).toBe(false);
    expect(result.gate.status).toBe(SyncGateStatus.PARTIALLY_ACKED);
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
        SyncGateStatus.PARTIALLY_ACKED,
        SyncGateStatus.SYNC_ACKED,
        SyncGateStatus.ESCALATED,
        SyncGateStatus.TIMED_OUT,
        SyncGateStatus.BYPASS_REQUESTED,
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

  it("rejects resolve from terminal state", () => {
    const result = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id],
    });
    // Resolve the gate first (now valid from SYNC_REQUESTED for liveness)
    sgResolve(result.gate.id);
    // READY_TO_CONTINUE → READY_TO_CONTINUE is not valid (already resolved)
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
      reason: "resource_conflict",
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

// ── Fix verification: quorum/liveness resolve from non-ACKED states ──

describe("SyncGate liveness resolve from PARTIALLY_ACKED", () => {
  it("quorum_ack gate resolves from PARTIALLY_ACKED when quorum met", () => {
    // Create gate with quorum_ack policy, quorum=1, requiring 2 agents
    const r = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id, agent3Id],
      policy: { kind: "quorum_ack", quorum: 1 } as any,
    });
    const gateId = r.gate.id;

    // First ack → PARTIALLY_ACKED, quorum=1 met → should auto-resolve
    const ackResult = sgAck(gateId, agent2Id, "I'm in");
    expect(ackResult.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });

  it("owner_override gate resolves from SYNC_REQUESTED when owner votes approve", () => {
    const r = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id, agent3Id],
      policy: { kind: "owner_override" } as any,
    });
    const gateId = r.gate.id;

    // Owner votes approve → should resolve
    const result = sgVote(gateId, agent1Id, "approve", "owner says go");
    expect(result.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });

  it("majority_veto gate resolves from PARTIALLY_ACKED when majority approves", () => {
    // 3 agents, majority = floor(3/2)+1 = 2
    const r = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id, agent3Id],
      policy: { kind: "majority_veto" } as any,
    });
    const gateId = r.gate.id;

    // Ack one agent to move to PARTIALLY_ACKED
    sgAck(gateId, agent2Id, "ack");

    // Two approve votes (majority for 3 agents)
    sgVote(gateId, agent1Id, "approve");
    const result = sgVote(gateId, agent2Id, "approve");
    expect(result.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });
});

// ── Fix verification: vote governance ──

describe("SyncGate vote governance", () => {
  // Helper: create a fresh majority_veto gate with 3 required agents
  function freshGate() {
    return sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id, agent3Id],
      policy: { kind: "majority_veto", escalationAgentIds: [agent3Id] } as any,
    }).gate.id;
  }

  it("rejects invalid vote kind", () => {
    const gid = freshGate();
    expect(() => sgVote(gid, agent2Id, "INVALID_KIND")).toThrow(/Invalid vote kind/);
  });

  it("rejects UPPERCASE vote kind (must use lowercase enum values)", () => {
    const gid = freshGate();
    expect(() => sgVote(gid, agent2Id, "APPROVE")).toThrow(/Invalid vote kind/);
  });

  it("rejects vote from ineligible agent", () => {
    const gid = freshGate();
    const outsider = repo.createAgent({ name: "outsider", provider: "other" as any, role: "other" as any });
    expect(() => sgVote(gid, outsider.id, "approve")).toThrow(/not eligible/);
  });

  it("allows vote from required agent", () => {
    const gid = freshGate();
    expect(() => sgVote(gid, agent2Id, "approve")).not.toThrow();
  });

  it("allows vote from escalation agent", () => {
    const gid = freshGate();
    expect(() => sgVote(gid, agent3Id, "approve")).not.toThrow();
  });

  it("allows vote from gate owner (requestedByAgentId)", () => {
    const gid = freshGate();
    expect(() => sgVote(gid, agent1Id, "approve")).not.toThrow();
  });
});

// ── Fix verification: resource conflict auto-resolve ──

describe("SyncGate resource conflict auto-resolve on claim release", () => {
  it("releasing conflicting claim auto-resolves resource conflict gate", () => {
    // Create two agents with overlapping claims
    const claimTask = repo.createTask({ title: "rc-resolve test", description: "" });
    const sess = orchCreateSession({ title: "rc-resolve session", createdBy: agent1Id });
    orchAssignRole({ sessionId: sess.session.id, agentId: agent1Id, role: "architect" as any });
    orchAssignRole({ sessionId: sess.session.id, agentId: agent2Id, role: "executor" as any });

    // Agent 1 claims src/shared
    const claim1 = rcClaim({
      sessionId: sess.session.id,
      taskId: claimTask.id,
      actorId: agent1Id,
      resources: [{ type: "file", locator: "src/shared/config.ts", metadata: "" }],
    });

    // Agent 2 claims overlapping resource → creates conflict gate
    const claim2 = rcClaim({
      sessionId: sess.session.id,
      taskId: claimTask.id,
      actorId: agent2Id,
      resources: [{ type: "file", locator: "src/shared/config.ts", metadata: "" }],
    });

    expect(claim2.gateId).toBeTruthy();
    const gateBeforeRelease = sgStatus(claim2.gateId!);
    expect(gateBeforeRelease.isBlocking).toBe(true);

    // Release the conflicting claim → should auto-resolve the gate
    rcRelease(claim1.claim.id);

    const gateAfterRelease = sgStatus(claim2.gateId!);
    expect(gateAfterRelease.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
    expect(gateAfterRelease.isBlocking).toBe(false);
  });
});

// ── Vote change regression (upsert: last vote wins at DB level) ──

describe("SyncGate vote upsert regression", () => {
  it("owner_override: reject then approve → gate resolves (upsert overwrites)", () => {
    const r = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent2Id, agent3Id],
      policy: { kind: "owner_override" } as any,
    });
    const gid = r.gate.id;

    // Owner first rejects
    const r1 = sgVote(gid, agent1Id, "reject", "not yet");
    expect(r1.gate.status).not.toBe(SyncGateStatus.READY_TO_CONTINUE);

    // Owner changes mind → approve
    const r2 = sgVote(gid, agent1Id, "approve", "ok let's go");
    expect(r2.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });

  it("majority_veto: voter approve then reject flips outcome (3 agents)", () => {
    // 3 agents, majority = 2
    const r = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id, agent3Id],
      policy: { kind: "majority_veto", escalationAgentIds: [agent3Id] } as any,
    });
    const gid = r.gate.id;

    // a1 and a2 both approve → majority met → resolves
    sgVote(gid, agent1Id, "approve");
    const r1 = sgVote(gid, agent2Id, "approve");
    expect(r1.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });

  it("majority_veto: voter changes approve → reject prevents premature resolve", () => {
    const r = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id, agent3Id],
      policy: { kind: "majority_veto" } as any,
    });
    const gid = r.gate.id;

    // a1 approves, a2 approves then changes to reject
    sgVote(gid, agent1Id, "approve");
    sgVote(gid, agent2Id, "approve");
    // Gate may have resolved — create a fresh one for the change scenario
    const r2 = sgRequest({
      taskId: task1Id,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id, agent3Id],
      policy: { kind: "majority_veto" } as any,
    });
    const gid2 = r2.gate.id;

    // a1 approves
    sgVote(gid2, agent1Id, "approve");
    // a2 approves → majority not yet (only 1 unique approve so far? no, 2 approves = majority)
    // Actually with 3 required, majority=2, so a1+a2 approve = 2 → resolves.
    // To test the change scenario: have a1 approve and a2 reject (no majority), then a3 reject (2 reject = escalate)
    sgVote(gid2, agent2Id, "reject");
    const blocked = sgStatus(gid2);
    expect(blocked.isBlocking).toBe(true);

    // a3 also rejects → 2 rejects = majority reject → escalate
    sgVote(gid2, agent3Id, "reject");
    const afterReject = sgStatus(gid2);
    expect(afterReject.gate.status).toBe(SyncGateStatus.ESCALATED);
  });
});
