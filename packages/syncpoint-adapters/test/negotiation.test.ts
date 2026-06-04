/**
 * Unit tests for Negotiation Protocol — state machine, deadlock detection, evaluation.
 */

import { describe, it, expect } from "vitest";
import {
  NegotiationStatus,
  NegotiationMessageKind,
  validateNegotiationTransition,
  parseNegotiationConfig,
  isNegotiationExpired,
  isRoundExpired,
  detectDeadlock,
  evaluateNegotiation,
  DEFAULT_NEGOTIATION_CONFIG,
} from "../src/negotiation.js";
import type { NegotiationSession, NegotiationMessage } from "../src/negotiation.js";

// ── helpers ─────────────────────────────────────────

function makeSession(overrides: Partial<NegotiationSession> = {}): NegotiationSession {
  return {
    id: "ns1",
    gateId: "g1",
    participantIds: ["a1", "a2"],
    status: NegotiationStatus.ROUND_ACTIVE,
    currentRound: 1,
    config: { ...DEFAULT_NEGOTIATION_CONFIG },
    roundStartedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    resolvedByAgentId: null,
    resolutionSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMsg(overrides: Partial<NegotiationMessage> = {}): NegotiationMessage {
  return {
    id: "m1",
    sessionId: "ns1",
    agentId: "a1",
    round: 1,
    kind: NegotiationMessageKind.PROPOSAL,
    content: "test",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── State machine ───────────────────────────────────

describe("negotiation state machine", () => {
  it("OPEN → ROUND_ACTIVE is valid", () => {
    expect(validateNegotiationTransition(NegotiationStatus.OPEN, NegotiationStatus.ROUND_ACTIVE)).toBe(true);
  });

  it("ROUND_ACTIVE → WAITING_FOR_RESPONSES is valid", () => {
    expect(validateNegotiationTransition(NegotiationStatus.ROUND_ACTIVE, NegotiationStatus.WAITING_FOR_RESPONSES)).toBe(true);
  });

  it("WAITING_FOR_RESPONSES → DEADLOCKED is valid", () => {
    expect(validateNegotiationTransition(NegotiationStatus.WAITING_FOR_RESPONSES, NegotiationStatus.DEADLOCKED)).toBe(true);
  });

  it("DEADLOCKED → ESCALATED is valid", () => {
    expect(validateNegotiationTransition(NegotiationStatus.DEADLOCKED, NegotiationStatus.ESCALATED)).toBe(true);
  });

  it("DEADLOCKED → RESOLVED is valid (human override)", () => {
    expect(validateNegotiationTransition(NegotiationStatus.DEADLOCKED, NegotiationStatus.RESOLVED)).toBe(true);
  });

  it("RESOLVED → anything is invalid", () => {
    for (const s of Object.values(NegotiationStatus)) {
      expect(validateNegotiationTransition(NegotiationStatus.RESOLVED, s as NegotiationStatus)).toBe(false);
    }
  });

  it("OPEN → DEADLOCKED is invalid", () => {
    expect(validateNegotiationTransition(NegotiationStatus.OPEN, NegotiationStatus.DEADLOCKED)).toBe(false);
  });
});

// ── Config parsing ──────────────────────────────────

describe("parseNegotiationConfig", () => {
  it("parses valid config", () => {
    const c = parseNegotiationConfig({ configJson: JSON.stringify({ maxRounds: 5, roundDeadlineMinutes: 10, negotiationDeadlineMinutes: 30 }) });
    expect(c.maxRounds).toBe(5);
    expect(c.roundDeadlineMinutes).toBe(10);
  });

  it("falls back to defaults on invalid JSON", () => {
    const c = parseNegotiationConfig({ configJson: "bad" });
    expect(c.maxRounds).toBe(3);
  });

  it("falls back to defaults on empty string", () => {
    const c = parseNegotiationConfig({ configJson: "" });
    expect(c.maxRounds).toBe(3);
  });
});

// ── Deadline checks ─────────────────────────────────

describe("isNegotiationExpired", () => {
  it("returns false when deadline in future", () => {
    const s = makeSession({ deadlineAt: new Date(Date.now() + 60_000).toISOString() });
    expect(isNegotiationExpired(s)).toBe(false);
  });

  it("returns true when deadline in past", () => {
    const s = makeSession({ deadlineAt: "2020-01-01T00:00:00Z" });
    expect(isNegotiationExpired(s)).toBe(true);
  });

  it("returns false when no deadline", () => {
    const s = makeSession({ deadlineAt: null });
    expect(isNegotiationExpired(s)).toBe(false);
  });
});

describe("isRoundExpired", () => {
  it("returns false when round just started", () => {
    const s = makeSession({ roundStartedAt: new Date().toISOString() });
    expect(isRoundExpired(s)).toBe(false);
  });

  it("returns true when round started 20m ago (15m deadline)", () => {
    const s = makeSession({ roundStartedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    expect(isRoundExpired(s)).toBe(true);
  });
});

// ── Deadlock detection ──────────────────────────────

describe("detectDeadlock", () => {
  it("returns false for round < 2", () => {
    expect(detectDeadlock([], 1, ["a1", "a2"])).toBe(false);
  });

  it("returns true when same stances 2 rounds, no new proposals", () => {
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a1", round: 2, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 2, kind: NegotiationMessageKind.REJECT }),
    ];
    expect(detectDeadlock(msgs, 2, ["a1", "a2"])).toBe(true);
  });

  it("returns false when stances differ", () => {
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a1", round: 2, kind: NegotiationMessageKind.ACCEPT }),
      makeMsg({ agentId: "a2", round: 2, kind: NegotiationMessageKind.REJECT }),
    ];
    expect(detectDeadlock(msgs, 2, ["a1", "a2"])).toBe(false);
  });

  it("returns false when new proposal in current round", () => {
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a1", round: 2, kind: NegotiationMessageKind.PROPOSAL }),
      makeMsg({ agentId: "a2", round: 2, kind: NegotiationMessageKind.REJECT }),
    ];
    expect(detectDeadlock(msgs, 2, ["a1", "a2"])).toBe(false);
  });
});

// ── evaluateNegotiation ─────────────────────────────

describe("evaluateNegotiation", () => {
  it("returns resolved for RESOLVED session", () => {
    const s = makeSession({ status: NegotiationStatus.RESOLVED });
    expect(evaluateNegotiation(s, []).action).toBe("resolved");
  });

  it("returns timeout when negotiation deadline passed", () => {
    const s = makeSession({ deadlineAt: "2020-01-01T00:00:00Z" });
    expect(evaluateNegotiation(s, []).action).toBe("timeout");
  });

  it("returns resolved when all participants accept", () => {
    const s = makeSession({ currentRound: 1 });
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.ACCEPT }),
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.ACCEPT }),
    ];
    expect(evaluateNegotiation(s, msgs).action).toBe("resolved");
  });

  it("latest stance wins: ACCEPT then REJECT is NOT resolved", () => {
    const s = makeSession({ currentRound: 1 });
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.ACCEPT }),
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.REJECT }), // changed mind
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.ACCEPT }),
    ];
    // a1's latest stance is REJECT → not all accepted
    expect(evaluateNegotiation(s, msgs).action).not.toBe("resolved");
  });

  it("latest stance wins: REJECT then ACCEPT IS resolved", () => {
    const s = makeSession({ currentRound: 1 });
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.ACCEPT }), // changed mind back
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.ACCEPT }),
    ];
    expect(evaluateNegotiation(s, msgs).action).toBe("resolved");
  });

  it("returns continue when waiting for responses", () => {
    const s = makeSession({ currentRound: 1 });
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.PROPOSAL }),
    ];
    expect(evaluateNegotiation(s, msgs).action).toBe("continue");
  });

  it("returns advance_round when round expired and not deadlocked", () => {
    const s = makeSession({
      currentRound: 1,
      roundStartedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    expect(evaluateNegotiation(s, []).action).toBe("advance_round");
  });

  it("returns deadlock when max rounds reached", () => {
    const s = makeSession({
      currentRound: 3,
      roundStartedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    const msgs = [
      makeMsg({ agentId: "a1", round: 3, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 3, kind: NegotiationMessageKind.REJECT }),
    ];
    expect(evaluateNegotiation(s, msgs).action).toBe("deadlock");
  });

  it("returns deadlock on repeated stances with no proposals", () => {
    const s = makeSession({
      currentRound: 2,
      roundStartedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    const msgs = [
      makeMsg({ agentId: "a1", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 1, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a1", round: 2, kind: NegotiationMessageKind.REJECT }),
      makeMsg({ agentId: "a2", round: 2, kind: NegotiationMessageKind.REJECT }),
    ];
    expect(evaluateNegotiation(s, msgs).action).toBe("deadlock");
  });
});
