/**
 * Integration tests for SyncTransaction Service — checkpoint approval flows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import {
  stxCreate, stxApprove, stxReject, stxResolve,
  stxCancel, stxStatus, stxList, stxListActive,
} from "./sync-transaction-service.js";
import { sgStatus, sgCheckAgent } from "./sync-gate-service.js";
import { orchCreateSession, orchAssignRole, orchPlanTask, orchAcceptAssignment, orchStartAssignment } from "./orchestration-service.js";
import { SyncTransactionStatus, SyncGateStatus } from "syncpoint-core";

function makeCheckpoint(taskId: string, agentId: string, summary: string) {
  return repo.createCheckpoint({
    taskId,
    agentId,
    summary,
    progress: "",
    currentUnderstanding: "",
    changedFiles: "",
    risks: "",
    blockers: "",
    nextSteps: "",
    needSync: true,
  });
}

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let agent3Id: string;
let task1Id: string;
let checkpointId: string;
let sessionId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-stx-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const a1 = repo.createAgent({ name: "arch", provider: "codex", role: "manager" });
  const a2 = repo.createAgent({ name: "reviewer-a", provider: "cursor", role: "reviewer" });
  const a3 = repo.createAgent({ name: "reviewer-b", provider: "claude-code", role: "reviewer" });
  agent1Id = a1.id;
  agent2Id = a2.id;
  agent3Id = a3.id;

  const t1 = repo.createTask({ title: "Auth module", description: "" });
  task1Id = t1.id;

  const cp = makeCheckpoint(task1Id, agent1Id, "Completed auth implementation");
  checkpointId = cp.id;

  const sess = orchCreateSession({ title: "STX test session", createdBy: agent1Id });
  sessionId = sess.session.id;
  orchAssignRole({ sessionId, agentId: agent1Id, role: "architect" as any });
  orchAssignRole({ sessionId, agentId: agent2Id, role: "reviewer" as any });
  orchAssignRole({ sessionId, agentId: agent3Id, role: "reviewer" as any });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SyncTransaction full lifecycle — approval flow", () => {
  let txId: string;
  let gateId: string;

  it("creates a transaction in WAITING_APPROVAL with a bound gate", () => {
    const result = stxCreate({
      sessionId,
      taskId: task1Id,
      checkpointId,
      requestingAgentId: agent1Id,
      requiredApproverIds: [agent2Id, agent3Id],
    });

    expect(result.tx.status).toBe(SyncTransactionStatus.WAITING_APPROVAL);
    expect(result.tx.gateId).toBeTruthy();
    expect(result.pending).toEqual([agent2Id, agent3Id]);
    expect(result.isBlocking).toBe(true);

    txId = result.tx.id;
    gateId = result.tx.gateId;
  });

  it("bound gate is in SYNC_REQUESTED and blocks approvers", () => {
    const gateResult = sgStatus(gateId);
    expect(gateResult.gate.status).toBe(SyncGateStatus.SYNC_REQUESTED);
    expect(gateResult.isBlocking).toBe(true);

    const block = sgCheckAgent(agent2Id, { taskId: task1Id });
    expect(block.blocked).toBe(true);
  });

  it("first approver approves — tx stays WAITING_APPROVAL", () => {
    const result = stxApprove(txId, agent2Id, "Looks good");
    expect(result.tx.status).toBe(SyncTransactionStatus.WAITING_APPROVAL);
    expect(result.pending).toEqual([agent3Id]);
    expect(result.allApproved).toBe(false);
  });

  it("second approver approves — tx advances to APPROVED", () => {
    const result = stxApprove(txId, agent3Id, "LGTM");
    expect(result.tx.status).toBe(SyncTransactionStatus.APPROVED);
    expect(result.pending).toEqual([]);
    expect(result.allApproved).toBe(true);
  });

  it("resolve tx → RESOLVED, gate → READY_TO_CONTINUE", () => {
    const result = stxResolve(txId, "Both reviewers approved");
    expect(result.tx.status).toBe(SyncTransactionStatus.RESOLVED);

    const gateResult = sgStatus(gateId);
    expect(gateResult.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
    expect(gateResult.isBlocking).toBe(false);
  });

  it("agent is no longer blocked after resolve", () => {
    const block = sgCheckAgent(agent2Id, { taskId: task1Id });
    expect(block.blocked).toBe(false);
  });
});

describe("SyncTransaction rejection flow", () => {
  let txId: string;
  let gateId: string;

  it("create transaction", () => {
    const cp2 = makeCheckpoint(task1Id, agent1Id, "Second checkpoint");
    const result = stxCreate({
      sessionId,
      taskId: task1Id,
      checkpointId: cp2.id,
      requestingAgentId: agent1Id,
      requiredApproverIds: [agent2Id],
    });
    txId = result.tx.id;
    gateId = result.tx.gateId;
  });

  it("rejection moves tx to REJECTED", () => {
    const result = stxReject(txId, agent2Id, "Needs rework");
    expect(result.tx.status).toBe(SyncTransactionStatus.REJECTED);
    expect(result.hasRejection).toBe(true);
  });

  it("rejected tx still blocks (gate still active)", () => {
    const result = stxStatus(txId);
    expect(result.isBlocking).toBe(true);

    const block = sgCheckAgent(agent2Id, { taskId: task1Id });
    expect(block.blocked).toBe(true);
  });

  it("resolve after rejection releases gate", () => {
    const result = stxResolve(txId, "Rework complete, force resolve");
    expect(result.tx.status).toBe(SyncTransactionStatus.RESOLVED);

    const gateResult = sgStatus(gateId);
    expect(gateResult.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });
});

describe("SyncTransaction cancellation", () => {
  let txId: string;
  let gateId: string;

  it("create and cancel", () => {
    const cp3 = makeCheckpoint(task1Id, agent1Id, "Third checkpoint");
    const result = stxCreate({
      sessionId,
      taskId: task1Id,
      checkpointId: cp3.id,
      requestingAgentId: agent1Id,
      requiredApproverIds: [agent2Id],
    });
    txId = result.tx.id;
    gateId = result.tx.gateId;

    const cancelled = stxCancel(txId, "No longer needed");
    expect(cancelled.status).toBe(SyncTransactionStatus.CANCELLED);
  });

  it("gate is also cancelled", () => {
    const gateResult = sgStatus(gateId);
    expect(gateResult.gate.status).toBe(SyncGateStatus.CANCELLED);
  });
});

describe("SyncTransaction validation", () => {
  it("throws if non-approver tries to approve", () => {
    const cp4 = makeCheckpoint(task1Id, agent1Id, "Fourth checkpoint");
    const result = stxCreate({
      sessionId,
      taskId: task1Id,
      checkpointId: cp4.id,
      requestingAgentId: agent1Id,
      requiredApproverIds: [agent2Id],
    });

    expect(() => stxApprove(result.tx.id, agent3Id, "")).toThrow(/not a required approver/);
    // cleanup
    stxCancel(result.tx.id, "test cleanup");
  });

  it("throws if approving a non-WAITING_APPROVAL tx", () => {
    const cp5 = makeCheckpoint(task1Id, agent1Id, "Fifth checkpoint");
    const result = stxCreate({
      sessionId,
      taskId: task1Id,
      checkpointId: cp5.id,
      requestingAgentId: agent1Id,
      requiredApproverIds: [agent2Id],
    });
    stxApprove(result.tx.id, agent2Id, "ok");
    // Now it's APPROVED, not WAITING_APPROVAL
    expect(() => stxApprove(result.tx.id, agent2Id, "again")).toThrow(/not in WAITING_APPROVAL/);
    // cleanup
    stxResolve(result.tx.id, "done");
  });
});

describe("SyncTransaction listing", () => {
  it("stxList returns all transactions", () => {
    const all = stxList();
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it("stxList filters by session", () => {
    const filtered = stxList({ sessionId });
    expect(filtered.length).toBeGreaterThanOrEqual(5);
  });

  it("stxListActive returns only active (blocking) ones", () => {
    const active = stxListActive({ sessionId });
    // All should be resolved/cancelled at this point
    expect(active.length).toBe(0);
  });
});

describe("SyncTransaction hard-gate enforcement via orchStartAssignment", () => {
  let assignmentId: string;
  let txId: string;

  it("setup: plan + accept assignment, create blocking tx", () => {
    const task2 = repo.createTask({ title: "Gated work", description: "" });
    const assignment = orchPlanTask({
      sessionId,
      taskId: task2.id,
      assigneeAgentId: agent2Id,
      assignedBy: agent1Id,
    });
    assignmentId = assignment.id;
    orchAcceptAssignment(assignmentId);

    const cp = makeCheckpoint(task2.id, agent1Id, "Blocking checkpoint");
    const result = stxCreate({
      sessionId,
      taskId: task2.id,
      checkpointId: cp.id,
      requestingAgentId: agent1Id,
      requiredApproverIds: [agent2Id],
    });
    txId = result.tx.id;
  });

  it("orchStartAssignment throws when tx gate blocks agent", () => {
    expect(() => orchStartAssignment(assignmentId)).toThrow(/sync gate/i);
  });

  it("approve + resolve tx allows start", () => {
    stxApprove(txId, agent2Id, "ok");
    stxResolve(txId, "approved");
    const ta = orchStartAssignment(assignmentId);
    expect(ta.status).toBe("IN_PROGRESS");
  });
});
