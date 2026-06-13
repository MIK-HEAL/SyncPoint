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
  GatePolicyKind,
  GateTimeoutAction,
  GateVoteKind,
  LivenessAction,
  quorumMet,
  parseGatePolicy,
  countVotes,
  evaluateGateLiveness,
  isGateBlocking,
  hasPartialAcks,
  computeGateDetails,
  computeAvailableActions,
} from "syncpoint-kernel";
import type { SyncGate, GateVote, GatePolicy } from "syncpoint-kernel";

// ── helpers ─────────────────────────────────────────

function makeGate(overrides: Partial<SyncGate> = {}): SyncGate {
  return {
    id: "g1",
    sessionId: "s1",
    taskId: "t1",
    requestedByAgentId: "a1",
    requiredAgentIds: ["a2", "a3"],
    ackedAgentIds: [],
    reason: SyncGateReason.MANUAL_REQUEST,
    description: "test gate",
    relatedFiles: [],
    relatedResources: [],
    relatedCheckpointId: "",
    relatedClaimIds: [],
    status: SyncGateStatus.SYNC_REQUESTED,
    decisionSummary: "",
    policy: makePolicy(),
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makeVote(overrides: Partial<GateVote> = {}): GateVote {
  return {
    id: "v1",
    gateId: "g1",
    agentId: "a2",
    vote: GateVoteKind.APPROVE,
    summary: "",
    createdAt: "2024-01-01",
    ...overrides,
  };
}

function makePolicy(policy: Record<string, unknown> = {}): GatePolicy {
  return {
    kind: GatePolicyKind.ALL_REQUIRED,
    timeoutAction: GateTimeoutAction.ESCALATE,
    ...policy,
  } as GatePolicy;
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
    expect(validateSyncGateTransition(SyncGateStatus.PARTIALLY_ACKED, SyncGateStatus.CANCELLED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.ESCALATED, SyncGateStatus.CANCELLED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.TIMED_OUT, SyncGateStatus.CANCELLED)).toBe(true);
    expect(validateSyncGateTransition(SyncGateStatus.BYPASS_REQUESTED, SyncGateStatus.CANCELLED)).toBe(true);
  });

  it("SYNC_REQUESTED → PARTIALLY_ACKED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.PARTIALLY_ACKED)).toBe(true);
  });

  it("PARTIALLY_ACKED → SYNC_ACKED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.PARTIALLY_ACKED, SyncGateStatus.SYNC_ACKED)).toBe(true);
  });

  it("SYNC_REQUESTED → ESCALATED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.ESCALATED)).toBe(true);
  });

  it("SYNC_REQUESTED → TIMED_OUT is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.TIMED_OUT)).toBe(true);
  });

  it("TIMED_OUT → ESCALATED is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.TIMED_OUT, SyncGateStatus.ESCALATED)).toBe(true);
  });

  it("TIMED_OUT → READY_TO_CONTINUE is valid (human decision)", () => {
    expect(validateSyncGateTransition(SyncGateStatus.TIMED_OUT, SyncGateStatus.READY_TO_CONTINUE)).toBe(true);
  });

  it("ESCALATED → READY_TO_CONTINUE is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.ESCALATED, SyncGateStatus.READY_TO_CONTINUE)).toBe(true);
  });

  it("BYPASS_REQUESTED → READY_TO_CONTINUE is valid", () => {
    expect(validateSyncGateTransition(SyncGateStatus.BYPASS_REQUESTED, SyncGateStatus.READY_TO_CONTINUE)).toBe(true);
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
    expect(allAcked(makeGate({ ackedAgentIds: ["a2"] }))).toBe(false);
  });

  it("true when all required acked", () => {
    expect(allAcked(makeGate({ ackedAgentIds: ["a2", "a3"] }))).toBe(true);
  });

  it("true with extra acks beyond required", () => {
    expect(allAcked(makeGate({ ackedAgentIds: ["a2", "a3", "a4"] }))).toBe(true);
  });
});

describe("pendingAgents", () => {
  it("returns all when none acked", () => {
    expect(pendingAgents(makeGate())).toEqual(["a2", "a3"]);
  });

  it("returns remaining after partial ack", () => {
    expect(pendingAgents(makeGate({ ackedAgentIds: ["a2"] }))).toEqual(["a3"]);
  });

  it("returns empty when all acked", () => {
    expect(pendingAgents(makeGate({ ackedAgentIds: ["a2", "a3"] }))).toEqual([]);
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
    expect(isAgentBlocked(makeGate({ ackedAgentIds: ["a2"] }), "a2")).toBe(true);
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

  it("new sideband states still block", () => {
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.PARTIALLY_ACKED }), "a2")).toBe(true);
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.ESCALATED }), "a2")).toBe(true);
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.TIMED_OUT }), "a2")).toBe(true);
    expect(isAgentBlocked(makeGate({ status: SyncGateStatus.BYPASS_REQUESTED }), "a2")).toBe(true);
  });
});

// ── isGateBlocking / hasPartialAcks ─────────────────

describe("isGateBlocking", () => {
  it("true for all non-terminal states", () => {
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.NEEDS_SYNC }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.SYNC_REQUESTED }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.PARTIALLY_ACKED }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.SYNC_ACKED }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.ESCALATED }))).toBe(true);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.TIMED_OUT }))).toBe(true);
  });

  it("false for terminal states", () => {
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.READY_TO_CONTINUE }))).toBe(false);
    expect(isGateBlocking(makeGate({ status: SyncGateStatus.CANCELLED }))).toBe(false);
  });
});

describe("hasPartialAcks", () => {
  it("false when no acks", () => {
    expect(hasPartialAcks(makeGate())).toBe(false);
  });

  it("true when some but not all acked", () => {
    expect(hasPartialAcks(makeGate({ ackedAgentIds: ["a2"] }))).toBe(true);
  });

  it("false when all acked", () => {
    expect(hasPartialAcks(makeGate({ ackedAgentIds: ["a2", "a3"] }))).toBe(false);
  });
});

// ── countVotes ──────────────────────────────────────

describe("countVotes", () => {
  it("counts by kind", () => {
    const votes = [
      makeVote({ vote: GateVoteKind.APPROVE }),
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a3" }),
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a4" }),
    ];
    const c = countVotes(votes);
    expect(c.approve).toBe(2);
    expect(c.reject).toBe(1);
    expect(c.abstain).toBe(0);
    expect(c.escalate).toBe(0);
  });
});

// ── parseGatePolicy ─────────────────────────────────

describe("parseGatePolicy", () => {
  it("returns default for empty policyJson", () => {
    const p = parseGatePolicy(makeGate());
    expect(p.kind).toBe(GatePolicyKind.ALL_REQUIRED);
  });

  it("parses valid JSON", () => {
    const p = parseGatePolicy(makeGate({
      policy: makePolicy({ kind: "quorum_ack", quorum: 1 }),
    }));
    expect(p.kind).toBe(GatePolicyKind.QUORUM_ACK);
    expect(p.quorum).toBe(1);
  });

  it("returns default for invalid policy object", () => {
    const p = parseGatePolicy(makeGate({ policy: { kind: "not-json" } as unknown as GatePolicy }));
    expect(p.kind).toBe(GatePolicyKind.ALL_REQUIRED);
  });
});

// ── evaluateGateLiveness ────────────────────────────

describe("evaluateGateLiveness", () => {
  const T = new Date("2024-06-01T12:00:00Z");

  // ── all_required (default, backward-compat) ──

  it("all_required: continue blocking when not all acked", () => {
    const d = evaluateGateLiveness(makeGate(), [], T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  it("all_required: continue blocking when all acked (explicit resolve needed)", () => {
    const d = evaluateGateLiveness(makeGate({ ackedAgentIds: ["a2", "a3"] }), [], T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  it("terminal state returns continue_blocking (no-op)", () => {
    const d = evaluateGateLiveness(makeGate({ status: SyncGateStatus.READY_TO_CONTINUE }), [], T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  // ── deadline timeout ──

  it("deadline passed → escalate (default timeoutAction)", () => {
    const gate = makeGate({
      policy: makePolicy({
        kind: "all_required",
        deadlineAt: "2024-06-01T11:00:00Z",
        escalationAgentIds: ["human1"],
      }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.ESCALATE);
    expect(d.escalateTo).toEqual(["human1"]);
  });

  it("deadline passed with cancel action → allow cancel", () => {
    const gate = makeGate({
      policy: makePolicy({
        kind: "all_required",
        deadlineAt: "2024-06-01T11:00:00Z",
        timeoutAction: "cancel",
      }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.ALLOW_CANCEL);
  });

  it("deadline passed with await_decision → require human override", () => {
    const gate = makeGate({
      policy: makePolicy({
        kind: "all_required",
        deadlineAt: "2024-06-01T11:00:00Z",
        timeoutAction: "await_decision",
      }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.REQUIRE_HUMAN_OVERRIDE);
  });

  it("deadline not yet passed → normal policy evaluation", () => {
    const gate = makeGate({
      policy: makePolicy({
        kind: "all_required",
        deadlineAt: "2024-06-01T13:00:00Z",
      }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  // ── lease expiry ──

  it("lease expired → escalate", () => {
    const gate = makeGate({
      policy: makePolicy({
        kind: "all_required",
        leaseExpiresAt: "2024-06-01T11:30:00Z",
        escalationAgentIds: ["sup1"],
      }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.ESCALATE);
    expect(d.escalateTo).toEqual(["sup1"]);
  });

  // ── quorum_ack ──

  it("quorum_ack: not met → blocking", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "quorum_ack", quorum: 2 }),
      ackedAgentIds: ["a2"],
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  it("quorum_ack: met → allow quorum resolve", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "quorum_ack", quorum: 1 }),
      ackedAgentIds: ["a2"],
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.ALLOW_QUORUM_RESOLVE);
  });

  it("quorum_ack: defaults to ceil(N/2) when quorum not specified", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "quorum_ack" }),
      requiredAgentIds: ["a1", "a2", "a3"],
      ackedAgentIds: ["a1", "a2"],
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.ALLOW_QUORUM_RESOLVE);
  });

  // ── majority_veto ──

  it("majority_veto: majority reject → escalate (not auto-pass)", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto", escalationAgentIds: ["sup"] }),
    });
    const votes = [
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a2" }),
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a3" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.ESCALATE);
    expect(d.escalateTo).toEqual(["sup"]);
  });

  it("majority_veto: majority approve → allow resolve", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto" }),
    });
    const votes = [
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a2" }),
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a3" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.ALLOW_QUORUM_RESOLVE);
  });

  it("majority_veto: no majority → continue blocking", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto" }),
    });
    const votes = [
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a2" }),
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a3" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  // ── owner_override ──

  it("owner_override: owner approved → auto-resolve", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "owner_override" }),
    });
    const votes = [
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a1" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.AUTO_RESOLVE);
  });

  it("owner_override: no owner vote, not all acked → blocking", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "owner_override" }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  it("owner_override: all acked → auto-resolve even without owner vote", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "owner_override" }),
      ackedAgentIds: ["a2", "a3"],
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.AUTO_RESOLVE);
  });

  // ── owner_override vote change regression ──

  it("owner_override: owner reject then approve → latest vote (approve) wins", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "owner_override" }),
    });
    // Simulate two votes from owner: reject first, then approve
    const votes = [
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a1" }),
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a1" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.AUTO_RESOLVE);
    expect(d.reason).toBe("Owner approved override");
  });

  it("owner_override: owner approve then reject → latest vote (reject) blocks", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "owner_override" }),
    });
    const votes = [
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a1" }),
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a1" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.CONTINUE_BLOCKING);
  });

  // ── majority_veto vote change regression ──

  it("majority_veto: voter changes approve → reject flips majority result", () => {
    // 3 required agents. majority = floor(3/2)+1 = 2
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto", escalationAgentIds: ["sup"] }),
    });
    // a2 initially approved, then changed to reject; a3 rejects
    // Deduped: a2=reject, a3=reject → 2 rejects (majority)
    const votes = [
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a2" }),
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a3" }),
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a2" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.ESCALATE);
  });

  it("majority_veto: voter changes reject → approve flips to resolve", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto" }),
    });
    // a2 initially rejected, then changed to approve; a3 approves
    // Deduped: a2=approve, a3=approve → 2 approves (majority)
    const votes = [
      makeVote({ vote: GateVoteKind.REJECT, agentId: "a2" }),
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a3" }),
      makeVote({ vote: GateVoteKind.APPROVE, agentId: "a2" }),
    ];
    const d = evaluateGateLiveness(gate, votes, T);
    expect(d.action).toBe(LivenessAction.ALLOW_QUORUM_RESOLVE);
  });

  // ── human_required ──

  it("human_required: always require human override", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "human_required", escalationAgentIds: ["human"] }),
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.REQUIRE_HUMAN_OVERRIDE);
    expect(d.escalateTo).toEqual(["human"]);
  });

  // ── deadline takes priority over policy ──

  it("deadline overrides quorum even if quorum met", () => {
    const gate = makeGate({
      policy: makePolicy({
        kind: "quorum_ack",
        quorum: 1,
        deadlineAt: "2024-06-01T11:00:00Z",
      }),
      ackedAgentIds: ["a2"],
    });
    const d = evaluateGateLiveness(gate, [], T);
    expect(d.action).toBe(LivenessAction.ESCALATE);
  });
});

// ── computeGateDetails ──────────────────────────────

describe("computeGateDetails", () => {
  it("returns pending, acked, required agent lists correctly", () => {
    const gate = makeGate({ ackedAgentIds: ["a2"] });
    const details = computeGateDetails(gate, []);
    expect(details.requiredAgentIds).toEqual(["a2", "a3"]);
    expect(details.ackedAgentIds).toEqual(["a2"]);
    expect(details.pendingAgentIds).toEqual(["a3"]);
    expect(details.isBlocking).toBe(true);
  });

  it("returns vote counts with dedup", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto" }),
    });
    const votes = [
      makeVote({ agentId: "a2", vote: GateVoteKind.APPROVE }),
      makeVote({ agentId: "a2", vote: GateVoteKind.REJECT }),
      makeVote({ agentId: "a3", vote: GateVoteKind.APPROVE }),
    ];
    const details = computeGateDetails(gate, votes);
    // a2's last vote is reject, a3 approve
    expect(details.voteCounts[GateVoteKind.APPROVE]).toBe(1);
    expect(details.voteCounts[GateVoteKind.REJECT]).toBe(1);
  });

  it("marks requiresHuman for ESCALATED gate", () => {
    const gate = makeGate({ status: SyncGateStatus.ESCALATED });
    const details = computeGateDetails(gate, []);
    expect(details.requiresHuman).toBe(true);
  });

  it("marks requiresHuman for human_required policy", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "human_required", escalationAgentIds: ["human"] }),
    });
    const details = computeGateDetails(gate, []);
    expect(details.requiresHuman).toBe(true);
  });

  it("does not mark requiresHuman for normal quorum gate", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "quorum_ack", quorum: 1 }),
    });
    const details = computeGateDetails(gate, []);
    expect(details.requiresHuman).toBe(false);
  });

  it("eligible voters include required + owner + escalation (deduped)", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto", escalationAgentIds: ["esc1"] }),
    });
    const details = computeGateDetails(gate, []);
    // required: a2, a3; owner: a1; escalation: esc1
    expect(details.eligibleVoterIds).toContain("a1");
    expect(details.eligibleVoterIds).toContain("a2");
    expect(details.eligibleVoterIds).toContain("a3");
    expect(details.eligibleVoterIds).toContain("esc1");
  });

  it("includes deadlineAt from policy", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "quorum_ack", quorum: 1, deadlineAt: "2025-01-01T00:00:00Z" }),
    });
    const details = computeGateDetails(gate, []);
    expect(details.deadlineAt).toBe("2025-01-01T00:00:00Z");
  });
});

// ── computeAvailableActions ─────────────────────────

describe("computeAvailableActions", () => {
  it("unacked required agent can ack and vote", () => {
    const gate = makeGate();
    const actions = computeAvailableActions(gate, "a2", []);
    expect(actions).toContain("ack");
    expect(actions).toContain("vote");
  });

  it("acked required agent gets change_vote instead of ack", () => {
    const gate = makeGate({ ackedAgentIds: ["a2"] });
    const votes = [makeVote({ agentId: "a2", vote: GateVoteKind.APPROVE })];
    const actions = computeAvailableActions(gate, "a2", votes);
    expect(actions).not.toContain("ack");
    expect(actions).toContain("change_vote");
  });

  it("owner with owner_override policy gets owner_override action", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "owner_override" }),
    });
    const actions = computeAvailableActions(gate, "a1", []);
    expect(actions).toContain("owner_override");
    expect(actions).toContain("resolve");
    expect(actions).toContain("cancel");
  });

  it("escalation agent gets resolve, cancel, request_more_info", () => {
    const gate = makeGate({
      policy: makePolicy({ kind: "majority_veto", escalationAgentIds: ["esc1"] }),
    });
    const actions = computeAvailableActions(gate, "esc1", []);
    expect(actions).toContain("resolve");
    expect(actions).toContain("cancel");
    expect(actions).toContain("request_more_info");
  });

  it("non-involved agent gets view_only", () => {
    const gate = makeGate();
    const actions = computeAvailableActions(gate, "outsider", []);
    expect(actions).toEqual(["view_only"]);
  });

  it("resolved gate returns view_only for everyone", () => {
    const gate = makeGate({ status: SyncGateStatus.READY_TO_CONTINUE });
    const actions = computeAvailableActions(gate, "a2", []);
    expect(actions).toEqual(["view_only"]);
  });
});
