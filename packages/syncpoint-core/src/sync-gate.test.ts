/**
 * Unit tests for SyncGate — status transitions, ack logic, blocking.
 */

import { describe, it, expect } from "vitest";
import {
  SyncGateStatus,
  SyncGateReason,
  SYNC_GATE_TRANSITIONS,
  validateSyncGateTransition,
  parseIdList,
  allAcked,
  pendingAgents,
  isAgentBlocked,
} from "./sync-gate.js";
import type { SyncGate } from "./sync-gate.js";

// ── helpers ─────────────────────────────────────────

function makeGate(overrides: Partial<SyncGate> = {}): SyncGate {
  return {
    id: "g1",
    sessionId: "s1",
    taskId: "t1",
    requestedByAgentId: "a1",
    requiredAgentIds: "a2,a3",
    ackedAgentIds: "",
    reason: SyncGateReason.MANUAL_REQUEST,
    description: "test gate",
    relatedFiles: "",
    relatedCheckpointId: "",
    relatedClaimIds: "",
    status: SyncGateStatus.SYNC_REQUESTED,
    decisionSummary: "",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

// ── transitions ─────────────────────────────────────

describe("SyncGate transitions", () => {
  it("NEEDS_SYNC → SYNC_REQUESTED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.NEEDS_SYNC, SyncGateStatus.SYNC_REQUESTED)).toBe(true);
  });

  it("SYNC_REQUESTED → SYNC_ACKED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.SYNC_ACKED)).toBe(true);
  });

  it("SYNC_ACKED → READY_TO_CONTINUE is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_ACKED, SyncGateStatus.READY_TO_CONTINUE)).toBe(true);
  });

  it("READY_TO_CONTINUE is terminal", () => {
    expect(SYNC_GATE_TRANSITIONS[SyncGateStatus.READY_TO_CONTINUE]).toHaveLength(0);
  });

  it("CANCELLED is terminal", () => {
    expect(SYNC_GATE_TRANSITIONS[SyncGateStatus.CANCELLED]).toHaveLength(0);
  });

  it("any non-terminal → CANCELLED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.NEEDS_SYNC, SyncGateStatus.CANCELLED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.CANCELLED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_ACKED, SyncGateStatus.CANCELLED)).toBe(true);
  });

  it("backward transitions are invalid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_ACKED, SyncGateStatus.NEEDS_SYNC)).toBe(false);
    expect(validateSyncGateTransition(SyncGateStatus.READY_TO_CONTINUE, SyncGateStatus.SYNC_REQUESTED)).toBe(false);
  });
});

// ── parseIdList ─────────────────────────────────────

describe("parseIdList", () => {
  it("splits comma-separated IDs", () => {
    expect(parseIdList("a1,a2,a3")).toEqual(["a1", "a2", "a3"]);
  });

  it("trims whitespace", () => {
    expect(parseIdList(" a1 , a2 ")).toEqual(["a1", "a2"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseIdList("")).toEqual([]);
  });
});

// ── allAcked / pendingAgents ────────────────────────

describe("allAcked", () => {
  it("false when no agents have acked", () => {
    expect(allAcked(makeGate())).toBe(false);
  });

  it("false when partial ack", () => {
    expect(allAcked(makeGate({ ackedAgentIds: "a2" }))).toBe(false);
  });

  it("true when all required acked", () => {
    expect(allAcked(makeGate({ ackedAgentIds: "a2,a3" }))).toBe(true);
  });

  it("true with extra acks beyond required", () => {
    expect(allAcked(makeGate({ ackedAgentIds: "a2,a3,a4" }))).toBe(true);
  });
});

describe("pendingAgents", () => {
  it("returns all when none acked", () => {
    expect(pendingAgents(makeGate())).toEqual(["a2", "a3"]);
  });

  it("returns remaining after partial ack", () => {
    expect(pendingAgents(makeGate({ ackedAgentIds: "a2" }))).toEqual(["a3"]);
  });

  it("returns empty when all acked", () => {
    expect(pendingAgents(makeGate({ ackedAgentIds: "a2,a3" }))).toEqual([]);
  });
});

// ── isAgentBlocked ──────────────────────────────────

describe("isAgentBlocked", () => {
  it("required agent is blocked when gate is SYNC_REQUESTED and not acked", () => {
    expect(isAgentBlocked(makeGate(), "a2")).toBe(true);
  });

  it("required agent is blocked when gate is NEEDS_SYNC", () => {
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.NEEDS_SYNC }), "a2")).toBe(true);
  });

  it("required agent is still blocked after acking until the gate is resolved", () => {
    expect(isAgentBlocked(makeGate({ ackedAgentIds: "a2" }), "a2")).toBe(true);
  });

  it("non-required agent is NOT blocked", () => {
    expect(isAgentBlocked(makeGate(), "a99")).toBe(false);
  });

  it("no one is blocked when gate is READY_TO_CONTINUE", () => {
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.READY_TO_CONTINUE }), "a2")).toBe(false);
  });

  it("no one is blocked when gate is CANCELLED", () => {
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.CANCELLED }), "a2")).toBe(false);
  });

  it("SYNC_ACKED still blocks until READY_TO_CONTINUE", () => {
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.SYNC_ACKED }), "a2")).toBe(true);
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.SYNC_ACKED }), "a3")).toBe(true);
  });
});
