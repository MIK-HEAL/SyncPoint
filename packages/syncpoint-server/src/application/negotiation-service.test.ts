/**
 * Integration tests for Negotiation Service.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../db.js";
import { createAgent, createTask } from "../repositories/index.js";
import { listNegotiationSessions, updateNegotiationSession } from "../repositories/negotiation-repository.js";
import { sgRequest, sgStatus, sgResolve } from "./sync-gate-service.js";
import { SyncGateStatus } from "syncpoint-kernel";
import {
  negStart, negMessage, negReconcile, negResolve, negEscalate, negStatus,
} from "./negotiation-service.js";
import { NegotiationStatus, NegotiationMessageKind } from "syncpoint-adapters";

let tmpDir: string;
let a1: string, a2: string, a3: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-neg-test-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  a1 = createAgent({ name: "neg-a1", provider: "other", role: "backend" }).id;
  a2 = createAgent({ name: "neg-a2", provider: "other", role: "frontend" }).id;
  a3 = createAgent({ name: "neg-a3", provider: "other", role: "tester" }).id;
  taskId = createTask({ title: "Negotiation test task", description: "" }).id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("negStart", () => {
  it("creates a negotiation session bound to a gate", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);
    expect(session.status).toBe(NegotiationStatus.ROUND_ACTIVE);
    expect(session.currentRound).toBe(1);
    expect(session.gateId).toBe(gate.gate.id);
    expect(session.deadlineAt).toBeDefined();
  });

  it("rejects negotiation with < 2 participants", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    expect(() => negStart(gate.gate.id, [a1])).toThrow("at least 2 participants");
  });

  it("rejects duplicate active negotiation for same gate", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    negStart(gate.gate.id, [a1, a2]);
    expect(() => negStart(gate.gate.id, [a1, a2])).toThrow("Active negotiation already exists");
  });

  it("repository list applies gateId and status together", () => {
    const gateA = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const gateB = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });

    const sessionA = negStart(gateA.gate.id, [a1, a2]);
    const sessionB = negStart(gateB.gate.id, [a1, a2]);

    updateNegotiationSession(sessionA.id, { status: NegotiationStatus.WAITING_FOR_RESPONSES });
    updateNegotiationSession(sessionB.id, { status: NegotiationStatus.WAITING_FOR_RESPONSES });

    const matches = listNegotiationSessions({
      gateId: gateA.gate.id,
      status: NegotiationStatus.WAITING_FOR_RESPONSES,
    });

    expect(matches.map(s => s.id)).toEqual([sessionA.id]);
  });
});

describe("negMessage", () => {
  it("posts a proposal and returns updated session", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);
    const result = negMessage(session.id, a1, "PROPOSAL", "I suggest approach A");
    expect(result.message.kind).toBe("PROPOSAL");
    expect(result.message.round).toBe(1);
  });

  it("rejects message from non-participant", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);
    expect(() => negMessage(session.id, a3, "PROPOSAL", "outsider")).toThrow("not a participant");
  });

  it("rejects invalid message kind", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);
    expect(() => negMessage(session.id, a1, "INVALID", "bad")).toThrow("Invalid message kind");
  });
});

describe("negotiation lifecycle", () => {
  it("resolves when all participants accept", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);

    negMessage(session.id, a1, "ACCEPT", "I accept");
    negMessage(session.id, a2, "ACCEPT", "I accept too");

    const status = negStatus(session.id);
    expect(status.session.status).toBe(NegotiationStatus.RESOLVED);
    expect(status.lastAction).toBe("resolved");
  });

  it("deadlocks after max rounds with no resolution", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    // Use 1-minute round deadline for test
    const session = negStart(gate.gate.id, [a1, a2], {
      maxRounds: 2,
      roundDeadlineMinutes: 0, // immediate expiry
    });

    // Round 1: both reject
    negMessage(session.id, a1, "REJECT", "no");
    negMessage(session.id, a2, "REJECT", "no");

    // Reconcile should advance or deadlock
    const r1 = negReconcile(session.id);
    // With maxRounds=2 and round expired immediately, after round 1 it should advance
    if (r1.action === "advance_round") {
      // Round 2: same stances
      negMessage(session.id, a1, "REJECT", "still no");
      negMessage(session.id, a2, "REJECT", "still no");

      const r2 = negReconcile(session.id);
      expect(r2.action).toBe("deadlock");
      expect(r2.session.status).toBe(NegotiationStatus.DEADLOCKED);
    } else {
      // Might deadlock immediately at max rounds
      expect(r1.session.status).toBe(NegotiationStatus.DEADLOCKED);
    }
  });

  it("human resolve overrides deadlock", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2], {
      maxRounds: 1,
      roundDeadlineMinutes: 0,
    });

    negMessage(session.id, a1, "REJECT", "no");
    negMessage(session.id, a2, "REJECT", "no");
    negReconcile(session.id);

    const resolved = negResolve(session.id, "human-1", "I override this");
    expect(resolved.status).toBe(NegotiationStatus.RESOLVED);
    expect(resolved.resolvedByAgentId).toBe("human-1");
    expect(resolved.resolutionSummary).toBe("I override this");
  });

  it("escalation from timed-out negotiation", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    // Set negotiation deadline to 0 minutes so it times out immediately
    const session = negStart(gate.gate.id, [a1, a2], {
      maxRounds: 3,
      roundDeadlineMinutes: 15,
      negotiationDeadlineMinutes: 0,
    });

    // Reconcile should detect expired negotiation deadline
    const r = negReconcile(session.id);
    expect(r.session.status).toBe(NegotiationStatus.TIMED_OUT);
    expect(r.action).toBe("timeout");

    const escalated = negEscalate(session.id);
    expect(escalated.status).toBe(NegotiationStatus.ESCALATED);
  });
});

describe("negStatus", () => {
  it("returns pending participant info", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);
    negMessage(session.id, a1, "PROPOSAL", "my proposal");

    const status = negStatus(session.id);
    expect(status.respondedAgentIds).toContain(a1);
    expect(status.pendingParticipantIds).toContain(a2);
    expect(status.totalMessages).toBe(1);
    expect(status.currentRound).toBe(1);
  });
});

// ── Gate writeback tests ────────────────────────────

describe("negotiation → gate writeback", () => {
  it("resolved negotiation resolves parent gate", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);

    negMessage(session.id, a1, "ACCEPT", "ok");
    negMessage(session.id, a2, "ACCEPT", "ok");
    negReconcile(session.id);

    const gateStatus = sgStatus(gate.gate.id);
    expect(gateStatus.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });

  it("timed-out negotiation sets gate to TIMED_OUT", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2], {
      negotiationDeadlineMinutes: 0,
    });

    negReconcile(session.id);

    const gateStatus = sgStatus(gate.gate.id);
    expect(gateStatus.gate.status).toBe(SyncGateStatus.TIMED_OUT);
  });

  it("escalated negotiation sets gate to ESCALATED", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2], {
      negotiationDeadlineMinutes: 0,
    });

    negReconcile(session.id);
    negEscalate(session.id);

    const gateStatus = sgStatus(gate.gate.id);
    expect(gateStatus.gate.status).toBe(SyncGateStatus.ESCALATED);
  });

  it("human negResolve resolves parent gate", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);

    negResolve(session.id, "human-1", "override");

    const gateStatus = sgStatus(gate.gate.id);
    expect(gateStatus.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });
});

// ── Safe writeback regression ────────────────────────

describe("safe gate writeback", () => {
  it("negotiation timeout does NOT regress already-resolved gate", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2], {
      negotiationDeadlineMinutes: 0,
    });

    // Resolve gate via another path BEFORE negotiation reconciles
    sgResolve(gate.gate.id, "resolved externally");

    // Now negotiation reconcile detects timeout
    negReconcile(session.id);

    // Gate should still be READY_TO_CONTINUE, NOT regressed to TIMED_OUT
    const gateStatus = sgStatus(gate.gate.id);
    expect(gateStatus.gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });
});

// ── Latest stance regression ────────────────────────

describe("latest stance wins", () => {
  it("ACCEPT then REJECT does NOT resolve negotiation", () => {
    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    const session = negStart(gate.gate.id, [a1, a2]);

    negMessage(session.id, a1, "ACCEPT", "ok");
    negMessage(session.id, a1, "REJECT", "changed mind");
    negMessage(session.id, a2, "ACCEPT", "ok");

    const status = negStatus(session.id);
    // a1's latest stance is REJECT → not resolved
    expect(status.session.status).not.toBe(NegotiationStatus.RESOLVED);
  });
});
