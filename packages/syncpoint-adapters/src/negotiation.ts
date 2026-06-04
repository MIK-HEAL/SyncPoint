/**
 * Negotiation Protocol — state machine, types, and pure functions.
 *
 * A negotiation session is bound to a sync gate and allows agents to
 * exchange proposals and counter-proposals to resolve a conflict.
 *
 * States: OPEN → ROUND_ACTIVE → WAITING_FOR_RESPONSES → RESOLVED | DEADLOCKED | TIMED_OUT → ESCALATED
 * Rules:  max_rounds=3, round_deadline=15m, negotiation_deadline=45m
 */

import { z } from "zod";

// ── Status enum ──────────────────────────────────────

export enum NegotiationStatus {
  OPEN = "OPEN",
  ROUND_ACTIVE = "ROUND_ACTIVE",
  WAITING_FOR_RESPONSES = "WAITING_FOR_RESPONSES",
  RESOLVED = "RESOLVED",
  DEADLOCKED = "DEADLOCKED",
  TIMED_OUT = "TIMED_OUT",
  ESCALATED = "ESCALATED",
}

// ── State machine transitions ────────────────────────

export const NEGOTIATION_TRANSITIONS: Record<NegotiationStatus, NegotiationStatus[]> = {
  [NegotiationStatus.OPEN]: [NegotiationStatus.ROUND_ACTIVE, NegotiationStatus.RESOLVED, NegotiationStatus.TIMED_OUT],
  [NegotiationStatus.ROUND_ACTIVE]: [NegotiationStatus.WAITING_FOR_RESPONSES, NegotiationStatus.RESOLVED, NegotiationStatus.TIMED_OUT],
  [NegotiationStatus.WAITING_FOR_RESPONSES]: [NegotiationStatus.ROUND_ACTIVE, NegotiationStatus.RESOLVED, NegotiationStatus.DEADLOCKED, NegotiationStatus.TIMED_OUT],
  [NegotiationStatus.RESOLVED]: [],
  [NegotiationStatus.DEADLOCKED]: [NegotiationStatus.ESCALATED, NegotiationStatus.RESOLVED],
  [NegotiationStatus.TIMED_OUT]: [NegotiationStatus.ESCALATED, NegotiationStatus.RESOLVED],
  [NegotiationStatus.ESCALATED]: [NegotiationStatus.RESOLVED],
};

export function validateNegotiationTransition(from: NegotiationStatus, to: NegotiationStatus): boolean {
  return NEGOTIATION_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Message kind ─────────────────────────────────────

export enum NegotiationMessageKind {
  PROPOSAL = "PROPOSAL",
  COUNTER = "COUNTER",
  ACCEPT = "ACCEPT",
  REJECT = "REJECT",
  COMMENT = "COMMENT",
}

// ── Default config ───────────────────────────────────

export const DEFAULT_NEGOTIATION_CONFIG = {
  maxRounds: 3,
  roundDeadlineMinutes: 15,
  negotiationDeadlineMinutes: 45,
} as const;

// ── Schemas ──────────────────────────────────────────

export const NegotiationConfigSchema = z.object({
  maxRounds: z.number().int().min(1).default(3),
  roundDeadlineMinutes: z.number().int().min(0).default(15),
  negotiationDeadlineMinutes: z.number().int().min(0).default(45),
});

export type NegotiationConfig = z.infer<typeof NegotiationConfigSchema>;

export const NegotiationSessionSchema = z.object({
  id: z.string(),
  gateId: z.string(),
  participantIds: z.array(z.string()),
  status: z.nativeEnum(NegotiationStatus),
  currentRound: z.number().int().min(0),
  config: NegotiationConfigSchema,
  roundStartedAt: z.string().optional().nullable(),
  deadlineAt: z.string().optional().nullable(),
  resolvedByAgentId: z.string().optional().nullable(),
  resolutionSummary: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type NegotiationSession = z.infer<typeof NegotiationSessionSchema>;

export const NegotiationMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  round: z.number().int().min(0),
  kind: z.nativeEnum(NegotiationMessageKind),
  content: z.string(),
  createdAt: z.string(),
});

export type NegotiationMessage = z.infer<typeof NegotiationMessageSchema>;

// ── Pure evaluation functions ────────────────────────

/**
 * Parse the config JSON stored on a session row.
 */
export function parseNegotiationConfig(session: { configJson: string } | string): NegotiationConfig {
  const rawConfig = typeof session === "string" ? session : session.configJson;
  try {
    const raw = JSON.parse(rawConfig || "{}");
    return NegotiationConfigSchema.parse(raw);
  } catch {
    return { ...DEFAULT_NEGOTIATION_CONFIG };
  }
}

/**
 * Check if the negotiation deadline has passed.
 */
export function isNegotiationExpired(session: NegotiationSession, now = new Date()): boolean {
  if (!session.deadlineAt) return false;
  return new Date(session.deadlineAt) <= now;
}

/**
 * Check if the current round deadline has passed.
 */
export function isRoundExpired(session: NegotiationSession, now = new Date()): boolean {
  if (!session.roundStartedAt) return false;
  const roundEnd = new Date(new Date(session.roundStartedAt).getTime() + session.config.roundDeadlineMinutes * 60_000);
  return roundEnd <= now;
}

/**
 * Detect deadlock: 2 consecutive rounds with same stances and no new proposal.
 * Returns true if deadlock detected.
 */
export function detectDeadlock(
  messages: NegotiationMessage[],
  currentRound: number,
  participantIds: string[],
): boolean {
  if (currentRound < 2) return false;

  // Get stances (last message kind per agent) for current and previous round
  function roundStances(round: number): Map<string, NegotiationMessageKind> {
    const stances = new Map<string, NegotiationMessageKind>();
    for (const m of messages.filter(msg => msg.round === round)) {
      stances.set(m.agentId, m.kind);
    }
    return stances;
  }

  const prev = roundStances(currentRound - 1);
  const curr = roundStances(currentRound);

  // Check if any new proposals were made this round
  const hasNewProposal = messages.some(
    m => m.round === currentRound &&
    (m.kind === NegotiationMessageKind.PROPOSAL || m.kind === NegotiationMessageKind.COUNTER)
  );
  if (hasNewProposal) return false;

  // Check if stances are identical between rounds
  for (const pid of participantIds) {
    const prevStance = prev.get(pid);
    const currStance = curr.get(pid);
    if (prevStance !== currStance) return false;
  }

  return true;
}

/**
 * Evaluate negotiation liveness: should it advance, deadlock, or timeout?
 */
export function evaluateNegotiation(
  session: NegotiationSession,
  messages: NegotiationMessage[],
  now = new Date(),
): { action: "continue" | "advance_round" | "deadlock" | "timeout" | "resolved"; reason: string } {
  // Terminal states
  if (session.status === NegotiationStatus.RESOLVED) {
    return { action: "resolved", reason: "Negotiation resolved" };
  }
  if (session.status === NegotiationStatus.ESCALATED) {
    return { action: "resolved", reason: "Negotiation escalated" };
  }

  // Global deadline
  if (isNegotiationExpired(session, now)) {
    return { action: "timeout", reason: "Negotiation deadline exceeded" };
  }

  const participants = session.participantIds;

  // Check for universal accept this round (latest stance per agent wins)
  const currentRoundMessages = messages.filter(m => m.round === session.currentRound);
  const latestStance = new Map<string, NegotiationMessageKind>();
  for (const m of currentRoundMessages) {
    latestStance.set(m.agentId, m.kind);
  }
  const allAccepted = participants.length > 0 &&
    participants.every(pid => latestStance.get(pid) === NegotiationMessageKind.ACCEPT);
  if (allAccepted) {
    return { action: "resolved", reason: "All participants accepted" };
  }

  // Round expired?
  if (isRoundExpired(session, now)) {
    // Deadlock check
    if (detectDeadlock(messages, session.currentRound, participants)) {
      return { action: "deadlock", reason: "Same stances for 2 consecutive rounds, no new proposals" };
    }

    // Max rounds reached?
    if (session.currentRound >= session.config.maxRounds) {
      return { action: "deadlock", reason: `Max rounds (${session.config.maxRounds}) reached without resolution` };
    }

    return { action: "advance_round", reason: "Round deadline passed, advancing to next round" };
  }

  // Waiting for all responses
  const responded = new Set(currentRoundMessages.map(m => m.agentId));
  if (responded.size < participants.length) {
    return { action: "continue", reason: `Waiting for ${participants.length - responded.size} response(s)` };
  }

  // All responded but no universal accept — check deadlock
  if (detectDeadlock(messages, session.currentRound, participants)) {
    return { action: "deadlock", reason: "Same stances for 2 consecutive rounds, no new proposals" };
  }

  // Max rounds?
  if (session.currentRound >= session.config.maxRounds) {
    return { action: "deadlock", reason: `Max rounds (${session.config.maxRounds}) reached without resolution` };
  }

  return { action: "advance_round", reason: "All responded, advancing to next round" };
}
