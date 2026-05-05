/**
 * SyncGate — synchronization barrier.
 *
 * A SyncGate blocks affected agents from proceeding until all
 * required agents acknowledge. Status flow:
 *
 *   NEEDS_SYNC → SYNC_REQUESTED → SYNC_ACKED → READY_TO_CONTINUE
 *
 * Gates can also be CANCELLED.
 */

import { z } from "zod";

// ── Status ──────────────────────────────────────────

export enum SyncGateStatus {
  /** A sync need has been identified but not yet formally requested */
  NEEDS_SYNC = "NEEDS_SYNC",
  /** Sync has been formally requested; waiting for acknowledgements */
  SYNC_REQUESTED = "SYNC_REQUESTED",
  /** All required agents have acknowledged */
  SYNC_ACKED = "SYNC_ACKED",
  /** Gate resolved — agents may continue */
  READY_TO_CONTINUE = "READY_TO_CONTINUE",
  /** Gate cancelled — no longer relevant */
  CANCELLED = "CANCELLED",
}

// ── Transitions ─────────────────────────────────────

export const SYNC_GATE_TRANSITIONS: Record<SyncGateStatus, SyncGateStatus[]> = {
  [SyncGateStatus.NEEDS_SYNC]: [SyncGateStatus.SYNC_REQUESTED, SyncGateStatus.CANCELLED],
  [SyncGateStatus.SYNC_REQUESTED]: [SyncGateStatus.SYNC_ACKED, SyncGateStatus.CANCELLED],
  [SyncGateStatus.SYNC_ACKED]: [SyncGateStatus.READY_TO_CONTINUE, SyncGateStatus.CANCELLED],
  [SyncGateStatus.READY_TO_CONTINUE]: [],
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
  if (gate.status === SyncGateStatus.READY_TO_CONTINUE || gate.status === SyncGateStatus.CANCELLED) {
    return false;
  }
  const required = parseIdList(gate.requiredAgentIds);
  return required.includes(agentId);
}
