/**
 * SyncGate — pure evaluation functions (liveness, voting, status computation).
 *
 * Extracted from sync-gate.ts to keep file sizes manageable.
 * Types and schemas remain in sync-gate.ts.
 */

import {
  SyncGateStatus,
  SYNC_GATE_TRANSITIONS,
  GatePolicyKind,
  GateTimeoutAction,
  GatePolicySchema,
  SyncGateSchema,
  DEFAULT_GATE_POLICY,
  GateVoteKind,
} from "./sync-gate.js";
import type { SyncGate, GatePolicy, GateVote } from "./sync-gate.js";

// Re-export for convenience (callers import from here or from sync-gate.ts)
export { GateVoteKind };

// ── Pure helpers ────────────────────────────────────

/**
 * Parse a comma-separated ID list into an array.
 */
export function parseIdList(ids: string[] | string): string[] {
  if (Array.isArray(ids)) return ids.map(s => s.trim()).filter(s => s.length > 0);
  return ids.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Check if all required agents have acknowledged.
 */
export function allAcked(gate: SyncGate): boolean {
  const required = parseIdList(gate.requiredAgentIds);
  const acked = parseIdList(gate.ackedAgentIds);
  return required.length > 0 && required.every(id => acked.includes(id));
}

/**
 * Check if quorum is met (N acks out of M required).
 */
export function quorumMet(gate: SyncGate, quorum: number): boolean {
  const acked = parseIdList(gate.ackedAgentIds);
  return acked.length >= quorum;
}

/**
 * Parse the gate's policy JSON. Returns DEFAULT_GATE_POLICY if empty/invalid.
 */
export function parseGatePolicy(gate: SyncGate): GatePolicy {
  try {
    return GatePolicySchema.parse(gate.policy ?? DEFAULT_GATE_POLICY);
  } catch {
    return { ...DEFAULT_GATE_POLICY };
  }
}

/**
 * Count votes by kind, deduplicating by agentId (latest vote wins).
 * This prevents vote-spamming from inflating counts.
 */
export function countVotes(votes: GateVote[]): Record<GateVoteKind, number> {
  const counts: Record<GateVoteKind, number> = {
    [GateVoteKind.APPROVE]: 0,
    [GateVoteKind.REJECT]: 0,
    [GateVoteKind.ABSTAIN]: 0,
    [GateVoteKind.ESCALATE]: 0,
  };
  // Deduplicate: last vote per agent wins (votes assumed ordered by createdAt asc)
  const lastVoteByAgent = new Map<string, GateVoteKind>();
  for (const v of votes) lastVoteByAgent.set(v.agentId, v.vote);
  for (const kind of lastVoteByAgent.values()) counts[kind]++;
  return counts;
}

// ── Liveness Decision ────────────────────────────────

export enum LivenessAction {
  /** Keep blocking — policy not yet satisfied */
  CONTINUE_BLOCKING = "continue_blocking",
  /** Escalate to designated agents or human */
  ESCALATE = "escalate",
  /** Quorum met — allow resolve */
  ALLOW_QUORUM_RESOLVE = "allow_quorum_resolve",
  /** Majority voted to cancel waiting */
  ALLOW_CANCEL = "allow_cancel",
  /** Must be resolved by human */
  REQUIRE_HUMAN_OVERRIDE = "require_human_override",
  /** Conflict no longer exists — auto-resolve */
  AUTO_RESOLVE = "auto_resolve",
}

export interface LivenessDecision {
  action: LivenessAction;
  reason: string;
  /** If ESCALATE, who to notify */
  escalateTo?: string[];
}

/**
 * Evaluate gate liveness — pure function, no side effects.
 *
 * Given a gate, its votes, and the current time, determines what
 * action should be taken. The service layer calls this lazily
 * (on sgCheckAgent, wakeNext, loopResume) and applies the result.
 */
export function evaluateGateLiveness(
  gate: SyncGate,
  votes: GateVote[],
  now: Date,
): LivenessDecision {
  // Terminal states — nothing to do
  if (
    gate.status === SyncGateStatus.READY_TO_CONTINUE ||
    gate.status === SyncGateStatus.CANCELLED
  ) {
    return { action: LivenessAction.CONTINUE_BLOCKING, reason: "gate already resolved" };
  }

  const policy = parseGatePolicy(gate);

  // Check deadline timeout first — applies to all policy kinds
  if (policy.deadlineAt) {
    const deadline = new Date(policy.deadlineAt);
    if (now >= deadline) {
      switch (policy.timeoutAction) {
        case GateTimeoutAction.ESCALATE:
          return {
            action: LivenessAction.ESCALATE,
            reason: `Deadline passed (${policy.deadlineAt})`,
            escalateTo: policy.escalationAgentIds,
          };
        case GateTimeoutAction.CANCEL:
          return { action: LivenessAction.ALLOW_CANCEL, reason: `Deadline passed — cancel` };
        case GateTimeoutAction.AWAIT_DECISION:
        default:
          return {
            action: LivenessAction.REQUIRE_HUMAN_OVERRIDE,
            reason: `Deadline passed — awaiting decision`,
            escalateTo: policy.escalationAgentIds,
          };
      }
    }
  }

  // Check lease expiry (staleness)
  if (policy.leaseExpiresAt) {
    const lease = new Date(policy.leaseExpiresAt);
    if (now >= lease) {
      return {
        action: LivenessAction.ESCALATE,
        reason: `Lease expired (no activity since ${policy.leaseExpiresAt})`,
        escalateTo: policy.escalationAgentIds,
      };
    }
  }

  // Policy-specific evaluation
  switch (policy.kind) {
    case GatePolicyKind.ALL_REQUIRED:
    default: {
      if (allAcked(gate)) {
        return { action: LivenessAction.CONTINUE_BLOCKING, reason: "All acked — awaiting explicit resolve" };
      }
      return { action: LivenessAction.CONTINUE_BLOCKING, reason: `Waiting: ${pendingAgents(gate).join(", ")}` };
    }

    case GatePolicyKind.QUORUM_ACK: {
      const q = policy.quorum ?? Math.ceil(parseIdList(gate.requiredAgentIds).length / 2);
      if (quorumMet(gate, q)) {
        return { action: LivenessAction.ALLOW_QUORUM_RESOLVE, reason: `Quorum met (${parseIdList(gate.ackedAgentIds).length}/${q})` };
      }
      return { action: LivenessAction.CONTINUE_BLOCKING, reason: `Quorum not met (${parseIdList(gate.ackedAgentIds).length}/${q})` };
    }

    case GatePolicyKind.MAJORITY_VETO: {
      const required = parseIdList(gate.requiredAgentIds);
      const voteCounts = countVotes(votes);
      const majority = Math.floor(required.length / 2) + 1;
      if (voteCounts[GateVoteKind.REJECT] >= majority && voteCounts[GateVoteKind.REJECT] > voteCounts[GateVoteKind.APPROVE]) {
        return {
          action: LivenessAction.ESCALATE,
          reason: `Majority rejected continued waiting (${voteCounts[GateVoteKind.REJECT]}/${majority})`,
          escalateTo: policy.escalationAgentIds,
        };
      }
      if (voteCounts[GateVoteKind.APPROVE] >= majority && voteCounts[GateVoteKind.APPROVE] > voteCounts[GateVoteKind.REJECT]) {
        return { action: LivenessAction.ALLOW_QUORUM_RESOLVE, reason: `Majority approved (${voteCounts[GateVoteKind.APPROVE]}/${majority})` };
      }
      return { action: LivenessAction.CONTINUE_BLOCKING, reason: "Voting in progress" };
    }

    case GatePolicyKind.OWNER_OVERRIDE: {
      const lastVoteByAgent = new Map<string, GateVoteKind>();
      for (const v of votes) lastVoteByAgent.set(v.agentId, v.vote);
      const ownerLatest = lastVoteByAgent.get(gate.requestedByAgentId);
      if (ownerLatest === GateVoteKind.APPROVE) {
        return { action: LivenessAction.AUTO_RESOLVE, reason: "Owner approved override" };
      }
      if (allAcked(gate)) {
        return { action: LivenessAction.AUTO_RESOLVE, reason: "All required agents acked" };
      }
      return { action: LivenessAction.CONTINUE_BLOCKING, reason: "Waiting for owner override or full ack" };
    }

    case GatePolicyKind.HUMAN_REQUIRED: {
      return {
        action: LivenessAction.REQUIRE_HUMAN_OVERRIDE,
        reason: "Human confirmation required",
        escalateTo: policy.escalationAgentIds,
      };
    }
  }
}

/**
 * List agents who have not yet acknowledged.
 */
export function pendingAgents(gate: SyncGate): string[] {
  const required = parseIdList(gate.requiredAgentIds);
  const acked = parseIdList(gate.ackedAgentIds);
  return required.filter(id => !acked.includes(id));
}

/**
 * Check if a specific agent is blocked by a gate.
 */
export function isAgentBlocked(gate: SyncGate, agentId: string): boolean {
  if (
    gate.status === SyncGateStatus.READY_TO_CONTINUE ||
    gate.status === SyncGateStatus.CANCELLED
  ) {
    return false;
  }
  const required = parseIdList(gate.requiredAgentIds);
  return required.includes(agentId);
}

/**
 * Check if a gate is in a "blocking" status (not yet resolved or cancelled).
 */
export function isGateBlocking(gate: SyncGate): boolean {
  return (
    gate.status !== SyncGateStatus.READY_TO_CONTINUE &&
    gate.status !== SyncGateStatus.CANCELLED
  );
}

/**
 * Check if a gate has any acks but not all — useful for PARTIALLY_ACKED detection.
 */
export function hasPartialAcks(gate: SyncGate): boolean {
  const acked = parseIdList(gate.ackedAgentIds);
  return acked.length > 0 && !allAcked(gate);
}

// ── Gate Detailed Status ─────────────────────────────

export type GateAction =
  | "ack"
  | "vote"
  | "change_vote"
  | "owner_override"
  | "resolve"
  | "cancel"
  | "request_more_info"
  | "view_only";

export interface GateDetailedStatus {
  gate: SyncGate;
  policy: GatePolicy;
  pendingAgentIds: string[];
  ackedAgentIds: string[];
  requiredAgentIds: string[];
  votes: GateVote[];
  voteCounts: Record<GateVoteKind, number>;
  eligibleVoterIds: string[];
  deadlineAt?: string;
  escalationAgentIds: string[];
  livenessPreview: LivenessDecision;
  isBlocking: boolean;
  requiresHuman: boolean;
}

/**
 * Compute available actions for a specific agent on a gate.
 */
export function computeAvailableActions(
  gate: SyncGate,
  agentId: string,
  votes: GateVote[],
): GateAction[] {
  if (!isGateBlocking(gate)) return ["view_only"];

  const policy = parseGatePolicy(gate);
  const required = parseIdList(gate.requiredAgentIds);
  const acked = parseIdList(gate.ackedAgentIds);
  const isRequired = required.includes(agentId);
  const isOwner = gate.requestedByAgentId === agentId;
  const isEscalation = (policy.escalationAgentIds ?? []).includes(agentId);

  // Deduplicate votes by agent
  const lastVoteByAgent = new Map<string, GateVoteKind>();
  for (const v of votes) lastVoteByAgent.set(v.agentId, v.vote);
  const hasVoted = lastVoteByAgent.has(agentId);
  const hasAcked = acked.includes(agentId);

  const actions: GateAction[] = [];

  if (isRequired && !hasAcked) {
    actions.push("ack");
  }

  if (isRequired || isOwner) {
    actions.push(hasVoted ? "change_vote" : "vote");
  }

  if (isOwner && policy.kind === GatePolicyKind.OWNER_OVERRIDE) {
    actions.push("owner_override");
  }

  if (isEscalation || isOwner) {
    actions.push("resolve", "cancel", "request_more_info");
  }

  return actions.length > 0 ? actions : ["view_only"];
}

/**
 * Compute the full detailed status of a gate.
 * Pure function — no I/O. Caller provides gate + votes.
 */
export function computeGateDetails(
  gate: SyncGate,
  votes: GateVote[],
  now?: Date,
): GateDetailedStatus {
  const policy = parseGatePolicy(gate);
  const required = parseIdList(gate.requiredAgentIds);
  const acked = parseIdList(gate.ackedAgentIds);
  const pending = required.filter(id => !acked.includes(id));
  const voteCts = countVotes(votes);

  const eligibleSet = new Set<string>([
    ...required,
    gate.requestedByAgentId,
    ...(policy.escalationAgentIds ?? []),
  ]);

  const livenessPreview = evaluateGateLiveness(gate, votes, now ?? new Date());

  const requiresHuman =
    gate.status === SyncGateStatus.TIMED_OUT ||
    gate.status === SyncGateStatus.ESCALATED ||
    policy.kind === GatePolicyKind.HUMAN_REQUIRED;

  return {
    gate,
    policy,
    pendingAgentIds: pending,
    ackedAgentIds: acked,
    requiredAgentIds: required,
    votes,
    voteCounts: voteCts,
    eligibleVoterIds: [...eligibleSet],
    deadlineAt: policy.deadlineAt,
    escalationAgentIds: policy.escalationAgentIds ?? [],
    livenessPreview,
    isBlocking: isGateBlocking(gate),
    requiresHuman,
  };
}
