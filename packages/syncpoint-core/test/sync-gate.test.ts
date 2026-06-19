import { describe, it, expect } from "vitest";
import {
  SyncGateStatus,
  SYNC_GATE_TRANSITIONS,
  validateSyncGateTransition,
  SyncGateReason,
  GatePolicyKind,
  GateTimeoutAction,
  DEFAULT_GATE_POLICY,
  GateVoteKind,
} from "syncpoint-kernel";
import {
  allAcked,
  quorumMet,
  parseGatePolicy,
  countVotes,
  LivenessAction,
  evaluateGateLiveness,
  pendingAgents,
  isAgentBlocked,
  isGateBlocking,
  hasPartialAcks,
  computeAvailableActions,
  computeGateDetails,
} from "syncpoint-kernel";
import type { SyncGate, GateVote } from "syncpoint-kernel";

// ── Helpers ──────────────────────────────────────────────

function makeGate(overrides: Partial<SyncGate> = {}): SyncGate {
  return {
    id: "gate-1",
    sessionId: "sess-1",
    taskId: "task-1",
    requestedByAgentId: "agent-architect",
    requiredAgentIds: ["agent-architect", "agent-executor", "agent-reviewer"],
    ackedAgentIds: [],
    reason: SyncGateReason.RESOURCE_CONFLICT,
    description: "test gate",
    relatedFiles: [],
    relatedResources: [],
    relatedCheckpointId: "",
    relatedClaimIds: [],
    status: SyncGateStatus.NEEDS_SYNC,
    escalated: false,
    escalatedAt: "",
    decisionSummary: "",
    policy: DEFAULT_GATE_POLICY,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Transitions ──────────────────────────────────────────

describe("SyncGate transitions", () => {
  it("all statuses have defined transitions", () => {
    for (const status of Object.values(SyncGateStatus)) {
      expect(SYNC_GATE_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("terminal statuses have no transitions", () => {
    expect(SYNC_GATE_TRANSITIONS[SyncGateStatus.READY_TO_CONTINUE]).toEqual([]);
    expect(SYNC_GATE_TRANSITIONS[SyncGateStatus.CANCELLED]).toEqual([]);
  });

  it("validateSyncGateTransition returns true for valid transitions", () => {
    expect(validateSyncGateTransition(SyncGateStatus.NEEDS_SYNC, SyncGateStatus.SYNC_REQUESTED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.SYNC_ACKED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_ACKED, SyncGateStatus.READY_TO_CONTINUE)).toBe(true);
  });

  it("validateSyncGateTransition returns false for invalid transitions", () => {
    expect(validateSyncGateTransition(SyncGateStatus.READY_TO_CONTINUE, SyncGateStatus.NEEDS_SYNC)).toBe(false);
    expect(validateSyncGateTransition(SyncGateStatus.CANCELLED, SyncGateStatus.NEEDS_SYNC)).toBe(false);
    expect(validateSyncGateTransition(SyncGateStatus.NEEDS_SYNC, SyncGateStatus.READY_TO_CONTINUE)).toBe(false);
  });

  it("NEEDS_SYNC can go to SYNC_REQUESTED or CANCELLED", () => {
    const to = SYNC_GATE_TRANSITIONS[SyncGateStatus.NEEDS_SYNC];
    expect(to).toContain(SyncGateStatus.SYNC_REQUESTED);
    expect(to).toContain(SyncGateStatus.CANCELLED);
  });

  it("SYNC_REQUESTED has expected transitions", () => {
    const to = SYNC_GATE_TRANSITIONS[SyncGateStatus.SYNC_REQUESTED];
    expect(to).toContain(SyncGateStatus.SYNC_ACKED);
    expect(to).toContain(SyncGateStatus.READY_TO_CONTINUE);
    expect(to).toContain(SyncGateStatus.CANCELLED);
  });
});

// ── allAcked ─────────────────────────────────────────────

describe("allAcked", () => {
  it("returns true when all required agents acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b"],
      ackedAgentIds: ["a", "b"],
    });
    expect(allAcked(gate)).toBe(true);
  });

  it("returns false when not all acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b"],
      ackedAgentIds: ["a"],
    });
    expect(allAcked(gate)).toBe(false);
  });

  it("returns false when no agents required", () => {
    const gate = makeGate({
      requiredAgentIds: [],
      ackedAgentIds: ["a"],
    });
    expect(allAcked(gate)).toBe(false);
  });
});

// ── quorumMet ────────────────────────────────────────────

describe("quorumMet", () => {
  it("returns true when ack count >= quorum", () => {
    const gate = makeGate({ ackedAgentIds: ["a", "b"] });
    expect(quorumMet(gate, 2)).toBe(true);
    expect(quorumMet(gate, 1)).toBe(true);
  });

  it("returns false when ack count < quorum", () => {
    const gate = makeGate({ ackedAgentIds: ["a"] });
    expect(quorumMet(gate, 2)).toBe(false);
  });
});

// ── pendingAgents ────────────────────────────────────────

describe("pendingAgents", () => {
  it("returns agents who have not acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b", "c"],
      ackedAgentIds: ["a"],
    });
    expect(pendingAgents(gate)).toEqual(["b", "c"]);
  });

  it("returns empty when all acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b"],
      ackedAgentIds: ["a", "b"],
    });
    expect(pendingAgents(gate)).toEqual([]);
  });
});

// ── isGateBlocking ───────────────────────────────────────

describe("isGateBlocking", () => {
  it("returns true for non-terminal statuses", () => {
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.NEEDS_SYNC }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.SYNC_REQUESTED }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.SYNC_ACKED }))).toBe(true);
  });

  it("returns false for terminal statuses", () => {
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.READY_TO_CONTINUE }))).toBe(false);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.CANCELLED }))).toBe(false);
  });
});

// ── isAgentBlocked ───────────────────────────────────────

describe("isAgentBlocked", () => {
  it("returns true for a required agent when gate is blocking", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
    });
    expect(isAgentBlocked(gate, "agent-executor")).toBe(true);
  });

  it("returns false for non-required agent", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
    });
    expect(isAgentBlocked(gate, "agent-other")).toBe(false);
  });

  it("returns false when gate is resolved", () => {
    const gate = makeGate({
      status: SyncGateStatus.READY_TO_CONTINUE,
      requiredAgentIds: ["agent-executor"],
    });
    expect(isAgentBlocked(gate, "agent-executor")).toBe(false);
  });
});

// ── hasPartialAcks ───────────────────────────────────────

describe("hasPartialAcks", () => {
  it("returns true when some but not all acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b"],
      ackedAgentIds: ["a"],
    });
    expect(hasPartialAcks(gate)).toBe(true);
  });

  it("returns false when all acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b"],
      ackedAgentIds: ["a", "b"],
    });
    expect(hasPartialAcks(gate)).toBe(false);
  });

  it("returns false when none acked", () => {
    const gate = makeGate({
      requiredAgentIds: ["a", "b"],
      ackedAgentIds: [],
    });
    expect(hasPartialAcks(gate)).toBe(false);
  });
});

// ── countVotes ───────────────────────────────────────────

describe("countVotes", () => {
  it("counts votes by kind, deduping by agent", () => {
    const votes: GateVote[] = [
      { id: "v1", gateId: "g1", agentId: "a1", vote: GateVoteKind.APPROVE, summary: "", createdAt: "2026-01-01T00:00:00Z" },
      { id: "v2", gateId: "g1", agentId: "a2", vote: GateVoteKind.REJECT, summary: "", createdAt: "2026-01-01T00:00:01Z" },
      { id: "v3", gateId: "g1", agentId: "a1", vote: GateVoteKind.ABSTAIN, summary: "", createdAt: "2026-01-01T00:00:02Z" },
    ];
    const result = countVotes(votes);
    // a1's last vote is ABSTAIN (v3 overrides v1)
    expect(result[GateVoteKind.APPROVE]).toBe(0);
    expect(result[GateVoteKind.REJECT]).toBe(1);
    expect(result[GateVoteKind.ABSTAIN]).toBe(1);
    expect(result[GateVoteKind.ESCALATE]).toBe(0);
  });

  it("returns zero counts for empty votes", () => {
    const result = countVotes([]);
    expect(result[GateVoteKind.APPROVE]).toBe(0);
    expect(result[GateVoteKind.REJECT]).toBe(0);
  });
});

// ── evaluateGateLiveness — CONTINUE_BLOCKING ─────────────

describe("evaluateGateLiveness", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("returns CONTINUE_BLOCKING for already-resolved gate", () => {
    const gate = makeGate({ status: SyncGateStatus.READY_TO_CONTINUE });
    const result = evaluateGateLiveness(gate, [], now);
    expect(result.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  // ── ALL_REQUIRED policy ────────────────────────────────

  describe("ALL_REQUIRED policy", () => {
    it("returns CONTINUE_BLOCKING when not all acked", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: { kind: GatePolicyKind.ALL_REQUIRED, timeoutAction: GateTimeoutAction.ESCALATE },
      });
      const result = evaluateGateLiveness(gate, [], now);
      expect(result.action).toBe(LivenessAction.CONTINUE_BLOCKING);
    });

    it("returns CONTINUE_BLOCKING even when all acked (awaiting explicit resolve)", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        requiredAgentIds: ["a"],
        ackedAgentIds: ["a"],
        policy: { kind: GatePolicyKind.ALL_REQUIRED, timeoutAction: GateTimeoutAction.ESCALATE },
      });
      const result = evaluateGateLiveness(gate, [], now);
      expect(result.action).toBe(LivenessAction.CONTINUE_BLOCKING);
    });
  });

  // ── QUORUM_ACK policy ──────────────────────────────────

  describe("QUORUM_ACK policy", () => {
    it("allows resolve when quorum met", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        requiredAgentIds: ["a", "b", "c"],
        ackedAgentIds: ["a", "b"],
        policy: { kind: GatePolicyKind.QUORUM_ACK, quorum: 2, timeoutAction: GateTimeoutAction.ESCALATE },
      });
      const result = evaluateGateLiveness(gate, [], now);
      expect(result.action).toBe(LivenessAction.ALLOW_QUORUM_RESOLVE);
    });

    it("blocks when quorum not met", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        requiredAgentIds: ["a", "b", "c"],
        ackedAgentIds: ["a"],
        policy: { kind: GatePolicyKind.QUORUM_ACK, quorum: 2, timeoutAction: GateTimeoutAction.ESCALATE },
      });
      const result = evaluateGateLiveness(gate, [], now);
      expect(result.action).toBe(LivenessAction.CONTINUE_BLOCKING);
    });
  });

  // ── Timeout handling ────────────────────────────────────

  describe("deadline timeout", () => {
    it("ESCALATE on expired deadline", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: {
          kind: GatePolicyKind.ALL_REQUIRED,
          deadlineAt: "2026-06-01T11:00:00.000Z",
          timeoutAction: GateTimeoutAction.ESCALATE,
          escalationAgentIds: ["admin-1"],
        },
      });
      const result = evaluateGateLiveness(gate, [], new Date("2026-06-01T12:00:00Z"));
      expect(result.action).toBe(LivenessAction.ESCALATE);
      expect(result.escalateTo).toEqual(["admin-1"]);
    });

    it("AUTO_RESOLVE on expired deadline with cancel action", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: {
          kind: GatePolicyKind.ALL_REQUIRED,
          deadlineAt: "2026-06-01T11:00:00.000Z",
          timeoutAction: GateTimeoutAction.CANCEL,
        },
      });
      const result = evaluateGateLiveness(gate, [], new Date("2026-06-01T12:00:00Z"));
      expect(result.action).toBe(LivenessAction.AUTO_RESOLVE);
    });

    it("ESCALATE on expired deadline with await_decision", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: {
          kind: GatePolicyKind.ALL_REQUIRED,
          deadlineAt: "2026-06-01T11:00:00.000Z",
          timeoutAction: GateTimeoutAction.AWAIT_DECISION,
        },
      });
      const result = evaluateGateLiveness(gate, [], new Date("2026-06-01T12:00:00Z"));
      expect(result.action).toBe(LivenessAction.ESCALATE);
    });

    it("does not timeout if deadline not passed", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: {
          kind: GatePolicyKind.ALL_REQUIRED,
          deadlineAt: "2026-06-01T13:00:00.000Z",
          timeoutAction: GateTimeoutAction.ESCALATE,
        },
      });
      const result = evaluateGateLiveness(gate, [], new Date("2026-06-01T12:00:00Z"));
      expect(result.action).toBe(LivenessAction.CONTINUE_BLOCKING);
    });
  });

  // ── Lease expiry ────────────────────────────────────────

  describe("lease expiry", () => {
    it("escalates on expired lease", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: {
          kind: GatePolicyKind.ALL_REQUIRED,
          leaseExpiresAt: "2026-06-01T11:00:00.000Z",
          timeoutAction: GateTimeoutAction.ESCALATE,
          escalationAgentIds: ["admin-1"],
        },
      });
      const result = evaluateGateLiveness(gate, [], new Date("2026-06-01T12:00:00Z"));
      expect(result.action).toBe(LivenessAction.ESCALATE);
    });

    it("does not escalate if lease not expired", () => {
      const gate = makeGate({
        status: SyncGateStatus.SYNC_REQUESTED,
        policy: {
          kind: GatePolicyKind.ALL_REQUIRED,
          leaseExpiresAt: "2026-06-01T13:00:00.000Z",
          timeoutAction: GateTimeoutAction.ESCALATE,
        },
      });
      const result = evaluateGateLiveness(gate, [], new Date("2026-06-01T12:00:00Z"));
      expect(result.action).toBe(LivenessAction.CONTINUE_BLOCKING);
    });
  });
});

// ── computeAvailableActions ──────────────────────────────

describe("computeAvailableActions", () => {
  it("returns view_only for resolved gate", () => {
    const gate = makeGate({ status: SyncGateStatus.READY_TO_CONTINUE });
    expect(computeAvailableActions(gate, "agent-executor", [])).toEqual(["view_only"]);
  });

  it("offers ack to required unacked agent", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
    });
    const actions = computeAvailableActions(gate, "agent-executor", []);
    expect(actions).toContain("ack");
  });

  it("does not offer ack if already acked", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
      ackedAgentIds: ["agent-executor"],
    });
    const actions = computeAvailableActions(gate, "agent-executor", []);
    expect(actions).not.toContain("ack");
  });

  it("offers vote to required agent", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
    });
    const actions = computeAvailableActions(gate, "agent-executor", []);
    expect(actions).toContain("vote");
  });

  it("offers change_vote if already voted", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
    });
    const votes: GateVote[] = [
      { id: "v1", gateId: "g1", agentId: "agent-executor", vote: GateVoteKind.APPROVE, summary: "", createdAt: "2026-01-01T00:00:00Z" },
    ];
    const actions = computeAvailableActions(gate, "agent-executor", votes);
    expect(actions).toContain("change_vote");
  });

  it("offers resolve/cancel/escalate to escalation agents", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      policy: {
        kind: GatePolicyKind.ALL_REQUIRED,
        timeoutAction: GateTimeoutAction.ESCALATE,
        escalationAgentIds: ["admin-1"],
      },
    });
    const actions = computeAvailableActions(gate, "admin-1", []);
    expect(actions).toContain("resolve");
    expect(actions).toContain("cancel");
  });

  it("returns view_only for non-required, non-owner, non-escalation agent", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["agent-executor"],
      requestedByAgentId: "agent-architect",
    });
    expect(computeAvailableActions(gate, "agent-rando", [])).toEqual(["view_only"]);
  });
});

// ── computeGateDetails ───────────────────────────────────

describe("computeGateDetails", () => {
  it("computes full gate status", () => {
    const gate = makeGate({
      status: SyncGateStatus.SYNC_REQUESTED,
      requiredAgentIds: ["a", "b", "c"],
      ackedAgentIds: ["a"],
    });
    const details = computeGateDetails(gate, []);
    expect(details.requiredAgentIds).toEqual(["a", "b", "c"]);
    expect(details.ackedAgentIds).toEqual(["a"]);
    expect(details.pendingAgentIds).toEqual(["b", "c"]);
    expect(details.isBlocking).toBe(true);
    expect(details.voteCounts[GateVoteKind.APPROVE]).toBe(0);
    expect(details.policy.kind).toBe(GatePolicyKind.ALL_REQUIRED);
  });

  it("detects requiresHuman when gate is escalated", () => {
    const gate = makeGate({ status: SyncGateStatus.SYNC_REQUESTED, escalated: true } as any);
    const details = computeGateDetails(gate, []);
    expect(details.requiresHuman).toBe(true);
  });
});
