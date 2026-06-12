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
import { ResourceRefSchema } from "./resource.js";

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

// ── Schema ──────────────────────────────────────────

export const SyncGateSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
  requestedByAgentId: z.string(),
  requiredAgentIds: z.array(z.string()).default([]),
  ackedAgentIds: z.array(z.string()).default([]),
  reason: z.nativeEnum(SyncGateReason),
  description: z.string(),
  relatedFiles: z.array(z.string()).default([]),
  relatedResources: z.array(ResourceRefSchema).default([]),
  relatedCheckpointId: z.string(),
  relatedClaimIds: z.array(z.string()).default([]),
  status: z.nativeEnum(SyncGateStatus),
  decisionSummary: z.string(),
  policy: GatePolicySchema.default(DEFAULT_GATE_POLICY),
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
  relatedFiles: z.array(z.string()).default([]),
  relatedResources: z.array(ResourceRefSchema).default([]),
  relatedCheckpointId: z.string().default(""),
  relatedClaimIds: z.array(z.string()).default([]),
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

// ── Pure helpers & evaluation — extracted to sync-gate-evaluate.ts ──
export {
  parseIdList,
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
} from "./sync-gate-evaluate.js";
export type {
  LivenessDecision,
  GateAction,
  GateDetailedStatus,
} from "./sync-gate-evaluate.js";
