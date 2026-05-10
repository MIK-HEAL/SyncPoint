/**
 * SyncGate — synchronization barrier.
 *
 * A SyncGate blocks affected agents from proceeding until the gate's
 * liveness policy is satisfied.  Status flow:
 *
 *   NEEDS_SYNC → SYNC_REQUESTED → PARTIALLY_ACKED → SYNC_ACKED → READY_TO_CONTINUE
 *
 * Sideband states:
 *   ESCALATED, TIMED_OUT, BYPASS_REQUESTED, CANCELLED
 *
 * TIMED_OUT does NOT auto-pass — it enters the decision layer.
 */

import { z } from "zod";

// ── Status ──────────────────────────────────────────

export enum SyncGateStatus {
  /** A sync need has been identified but not yet formally requested */
  NEEDS_SYNC = "NEEDS_SYNC",
  /** Sync has been formally requested; waiting for acknowledgements */
  SYNC_REQUESTED = "SYNC_REQUESTED",
  /** Some (but not all) required agents have acknowledged */
  PARTIALLY_ACKED = "PARTIALLY_ACKED",
  /** All required agents have acknowledged */
  SYNC_ACKED = "SYNC_ACKED",
  /** Gate resolved — agents may continue */
  READY_TO_CONTINUE = "READY_TO_CONTINUE",
  /** Gate escalated — handed to escalationAgentIds or human */
  ESCALATED = "ESCALATED",
  /** Gate timed out — NOT auto-pass, enters decision layer */
  TIMED_OUT = "TIMED_OUT",
  /** An agent requested bypass — pending owner/human approval */
  BYPASS_REQUESTED = "BYPASS_REQUESTED",
  /** Gate cancelled — no longer relevant */
  CANCELLED = "CANCELLED",
}

// ── Transitions ─────────────────────────────────────

export const SYNC_GATE_TRANSITIONS: Record<SyncGateStatus, SyncGateStatus[]> = {
  [SyncGateStatus.NEEDS_SYNC]: [SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.CANCELLED],
  [SyncGateStatus.SYNC_REQUESTED]: [
    SyncGateStatus.PARTIALLY_ACKED,
    SyncGateStatus.SYNC_ACKED,
    SyncGateStatus.READY_TO_CONTINUE,
    SyncGateStatus.ESCALATED,
    SyncGateStatus.TIMED_OUT,
    SyncGateStatus.CANCELLED,
  ],
  [SyncGateStatus.PARTIALLY_ACKED]: [
    SyncGateStatus.SYNC_ACKED,
    SyncGateStatus.READY_TO_CONTINUE,
    SyncGateStatus.ESCALATED,
    SyncGateStatus.TIMED_OUT,
    SyncGateStatus.CANCELLED,
  ],
  [SyncGateStatus.SYNC_ACKED]: [SyncGateStatus.READY_TO_CONTINUE, SyncGateStatus.CANCELLED],
  [SyncGateStatus.READY_TO_CONTINUE]: [],
  [SyncGateStatus.ESCALATED]: [
    SyncGateStatus.READY_TO_CONTINUE,
    SyncGateStatus.CANCELLED,
  ],
  [SyncGateStatus.TIMED_OUT]: [
    SyncGateStatus.ESCALATED,
    SyncGateStatus.READY_TO_CONTINUE,
    SyncGateStatus.CANCELLED,
  ],
  [SyncGateStatus.BYPASS_REQUESTED]: [
    SyncGateStatus.READY_TO_CONTINUE,
    SyncGateStatus.ESCALATED,
    SyncGateStatus.CANCELLED,
  ],
  [SyncGateStatus.CANCELLED]: [],
};

export function validateSyncGateTransition(from: SyncGateStatus, to: SyncGateStatus): boolean {
  return SYNC_GATE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Reason ──────────────────────────────────────────

export enum SyncGateReason {
  RESOURCE_CONFLICT = "resource_conflict",
  PHASE_TRANSITION = "phase_transition",
  MANUAL_REQUEST = "manual_request",
  CHECKPOINT_REQUIRED = "checkpoint_required",
  CONTEXT_DRIFT = "context_drift",
  BACKING_STORE_BYPASS = "backing_store_bypass",
}

// ── Schema ──────────────────────────────────────────

// ── Gate Policy ──────────────────────────────────────

export enum GatePolicyKind {
  /** Current behavior — all requiredAgentIds must ack */
  ALL_REQUIRED = "all_required",
  /** N of M acks is sufficient (quorum field) */
  QUORUM_ACK = "quorum_ack",
  /** Majority can veto "continue waiting" — triggers escalation, not auto-pass */
  MAJORITY_VETO = "majority_veto",
  /** Designated owner can resolve with reason */
  OWNER_OVERRIDE = "owner_override",
  /** High-risk gate: human confirmation required */
  HUMAN_REQUIRED = "human_required",
}

export enum GateTimeoutAction {
  /** Escalate to escalation agents */
  ESCALATE = "escalate",
  /** Cancel the gate */
  CANCEL = "cancel",
  /** Move to TIMED_OUT for manual decision */
  AWAIT_DECISION = "await_decision",
}

export const GatePolicySchema = z.object({
  kind: z.nativeEnum(GatePolicyKind).default(GatePolicyKind.ALL_REQUIRED),
  /** Quorum threshold — e.g. 2 means 2 acks suffice. Only used with quorum_ack */
  quorum: z.number().int().min(1).optional(),
  /** ISO deadline — gate must resolve by this time or timeout action fires */
  deadlineAt: z.string().optional(),
  /** Lease expiry — if no ack activity since this, treat as stale */
  leaseExpiresAt: z.string().optional(),
  /** Agents to escalate to when timeout or majority_veto */
  escalationAgentIds: z.array(z.string()).optional(),
  /** What happens on timeout */
  timeoutAction: z.nativeEnum(GateTimeoutAction).default(GateTimeoutAction.ESCALATE),
  /** Last time liveness was evaluated */
  lastLivenessCheckAt: z.string().optional(),
});

export type GatePolicy = z.infer<typeof GatePolicySchema>;

/** Default policy: exact backward-compatible behavior */
export const DEFAULT_GATE_POLICY: GatePolicy = {
  kind: GatePolicyKind.ALL_REQUIRED,
  timeoutAction: GateTimeoutAction.ESCALATE,
};

// ── Gate Ack ──────────────────────────────────────────
// Ack = "I see it / I'm aware". Stored separately from votes.
// One row per (gate, agent). Ack is monotonic: once acked, the row stays.

export const GateAckSchema = z.object({
  id: z.string(),
  gateId: z.string(),
  agentId: z.string(),
  summary: z.string().default(""),
  createdAt: z.string(),
});

export type GateAck = z.infer<typeof GateAckSchema>;

export const GateAckCreateSchema = z.object({
  gateId: z.string(),
  agentId: z.string(),
  summary: z.string().optional().default(""),
});

export type GateAckCreate = z.infer<typeof GateAckCreateSchema>;

// ── Gate Vote (governance only) ──────────────────────
// Vote = "I think we should approve/reject/escalate". Separate from ack.
// One row per (gate, agent). Last vote wins (overwrite via upsert).

export enum GateVoteKind {
  APPROVE = "approve",
  REJECT = "reject",
  ABSTAIN = "abstain",
  ESCALATE = "escalate",
}

export const GateVoteSchema = z.object({
  id: z.string(),
  gateId: z.string(),
  agentId: z.string(),
  vote: z.nativeEnum(GateVoteKind),
  summary: z.string().default(""),
  createdAt: z.string(),
});

export type GateVote = z.infer<typeof GateVoteSchema>;

export const GateVoteCreateSchema = z.object({
  gateId: z.string(),
  agentId: z.string(),
  vote: z.nativeEnum(GateVoteKind),
  summary: z.string().optional().default(""),
});

export type GateVoteCreate = z.infer<typeof GateVoteCreateSchema>;

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

// ── Schema ──────────────────────────────────────────

export const SyncGateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
  requestedByAgentId: z.string(),
  /** Comma-separated agent IDs that must acknowledge */
  requiredAgentIds: z.string(),
  /** Comma-separated agent IDs that have acknowledged so far */
  ackedAgentIds: z.string(),
  reason: z.nativeEnum(SyncGateReason),
  description: z.string(),
  relatedFiles: z.string(),
  relatedResourcesJson: z.string(),
  relatedCheckpointId: z.string(),
  relatedClaimIds: z.string(),
  status: z.nativeEnum(SyncGateStatus),
  decisionSummary: z.string(),
  /** Structured liveness policy (JSON) */
  policyJson: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SyncGate = z.infer<typeof SyncGateSchema>;

export const SyncGateCreateSchema = z.object({
  sessionId: z.string().optional().default(""),
  taskId: z.string(),
  requestedByAgentId: z.string(),
  requiredAgentIds: z.array(z.string()).min(1),
  reason: z.nativeEnum(SyncGateReason).default(SyncGateReason.MANUAL_REQUEST),
  description: z.string().default(""),
  relatedFiles: z.string().default(""),
  relatedResourcesJson: z.string().default(""),
  relatedCheckpointId: z.string().default(""),
  relatedClaimIds: z.string().default(""),
  policy: GatePolicySchema.optional(),
});

export type SyncGateCreate = z.infer<typeof SyncGateCreateSchema>;

// ── Acknowledgement ─────────────────────────────────

export const SyncGateAckSchema = z.object({
  gateId: z.string(),
  agentId: z.string(),
  summary: z.string().optional().default(""),
});

export type SyncGateAck = z.infer<typeof SyncGateAckSchema>;

// ── Pure helpers ────────────────────────────────────

/**
 * Parse a comma-separated ID list into an array.
 */
export function parseIdList(ids: string): string[] {
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
  if (!gate.policyJson) return { ...DEFAULT_GATE_POLICY };
  try {
    return GatePolicySchema.parse(JSON.parse(gate.policyJson));
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
      // all_required preserves explicit resolve protocol (backward compat):
      // all ack → SYNC_ACKED, then explicit sgResolve → READY_TO_CONTINUE.
      // Liveness evaluator only intervenes for timeout/lease.
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
      // Majority reject (and more rejects than approves) → escalate
      if (voteCounts[GateVoteKind.REJECT] >= majority && voteCounts[GateVoteKind.REJECT] > voteCounts[GateVoteKind.APPROVE]) {
        return {
          action: LivenessAction.ESCALATE,
          reason: `Majority rejected continued waiting (${voteCounts[GateVoteKind.REJECT]}/${majority})`,
          escalateTo: policy.escalationAgentIds,
        };
      }
      // Majority approve (and more approves than rejects) → allow resolve
      if (voteCounts[GateVoteKind.APPROVE] >= majority && voteCounts[GateVoteKind.APPROVE] > voteCounts[GateVoteKind.REJECT]) {
        return { action: LivenessAction.ALLOW_QUORUM_RESOLVE, reason: `Majority approved (${voteCounts[GateVoteKind.APPROVE]}/${majority})` };
      }
      return { action: LivenessAction.CONTINUE_BLOCKING, reason: "Voting in progress" };
    }

    case GatePolicyKind.OWNER_OVERRIDE: {
      // Owner (requestedByAgentId) latest vote approve → allow
      // Use last vote per agent (in case of multiple votes, last wins)
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
 * An agent is blocked if:
 *  - They are in the requiredAgentIds
 *  - The gate has not reached READY_TO_CONTINUE or CANCELLED
 *
 * **Semantic note:** SYNC_ACKED gates still block agents.
 * A gate is only passed when it reaches READY_TO_CONTINUE.
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

  // Eligible voters: required agents + owner + escalation agents (deduplicated)
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
