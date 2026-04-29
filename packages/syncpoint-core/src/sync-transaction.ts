/**
 * SyncTransaction — checkpoint-driven synchronization transaction.
 *
 * A SyncTransaction wraps a checkpoint into a formal approval flow:
 *
 *   checkpoint --need-sync
 *     → create SyncTransaction (OPEN)
 *     → create/bind SyncGate (checkpoint_required)
 *     → approvers ack & approve (WAITING_APPROVAL → APPROVED)
 *     → resolve gate (→ READY_TO_CONTINUE)
 *     → agent can resume
 *
 * Rejection keeps the agent blocked and requires a follow-up action.
 *
 * Status flow:
 *   OPEN → WAITING_APPROVAL → APPROVED → RESOLVED
 *                           → REJECTED → RESOLVED (after follow-up)
 *   Any non-terminal → CANCELLED
 */

import { z } from "zod";

// ── Status ──────────────────────────────────────────

export enum SyncTransactionStatus {
  /** Transaction created, not yet submitted for approval */
  OPEN = "OPEN",
  /** Waiting for required approvers to decide */
  WAITING_APPROVAL = "WAITING_APPROVAL",
  /** All required approvers approved */
  APPROVED = "APPROVED",
  /** At least one approver rejected */
  REJECTED = "REJECTED",
  /** Transaction resolved — gate released, agent may continue */
  RESOLVED = "RESOLVED",
  /** Transaction cancelled */
  CANCELLED = "CANCELLED",
}

// ── Transitions ─────────────────────────────────────

export const SYNC_TX_TRANSITIONS: Record<SyncTransactionStatus, SyncTransactionStatus[]> = {
  [SyncTransactionStatus.OPEN]: [
    SyncTransactionStatus.WAITING_APPROVAL,
    SyncTransactionStatus.CANCELLED,
  ],
  [SyncTransactionStatus.WAITING_APPROVAL]: [
    SyncTransactionStatus.APPROVED,
    SyncTransactionStatus.REJECTED,
    SyncTransactionStatus.CANCELLED,
  ],
  [SyncTransactionStatus.APPROVED]: [
    SyncTransactionStatus.RESOLVED,
    SyncTransactionStatus.CANCELLED,
  ],
  [SyncTransactionStatus.REJECTED]: [
    SyncTransactionStatus.RESOLVED,
    SyncTransactionStatus.CANCELLED,
  ],
  [SyncTransactionStatus.RESOLVED]: [],
  [SyncTransactionStatus.CANCELLED]: [],
};

export function validateSyncTxTransition(from: SyncTransactionStatus, to: SyncTransactionStatus): boolean {
  return SYNC_TX_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Schema ──────────────────────────────────────────

export const SyncTransactionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
  checkpointId: z.string(),
  requestingAgentId: z.string(),
  /** Comma-separated agent IDs that must approve */
  requiredApproverIds: z.string(),
  /** Comma-separated agent IDs that have approved */
  approvedByIds: z.string(),
  /** Comma-separated agent IDs that have rejected */
  rejectedByIds: z.string(),
  /** Bound SyncGate ID (created automatically) */
  gateId: z.string(),
  status: z.nativeEnum(SyncTransactionStatus),
  decisionSummary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SyncTransaction = z.infer<typeof SyncTransactionSchema>;

export const SyncTransactionCreateSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
  checkpointId: z.string(),
  requestingAgentId: z.string(),
  requiredApproverIds: z.array(z.string()).min(1),
});

export type SyncTransactionCreate = z.infer<typeof SyncTransactionCreateSchema>;

// ── Pure helpers ────────────────────────────────────

/**
 * Parse a comma-separated ID list into an array.
 */
export function parseTxIdList(ids: string): string[] {
  return ids.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Check if all required approvers have approved.
 */
export function allApproved(tx: SyncTransaction): boolean {
  const required = parseTxIdList(tx.requiredApproverIds);
  const approved = parseTxIdList(tx.approvedByIds);
  return required.length > 0 && required.every(id => approved.includes(id));
}

/**
 * Check if any approver has rejected.
 */
export function hasRejection(tx: SyncTransaction): boolean {
  return parseTxIdList(tx.rejectedByIds).length > 0;
}

/**
 * List approvers who have not yet decided.
 */
export function pendingApprovers(tx: SyncTransaction): string[] {
  const required = parseTxIdList(tx.requiredApproverIds);
  const approved = parseTxIdList(tx.approvedByIds);
  const rejected = parseTxIdList(tx.rejectedByIds);
  const decided = new Set([...approved, ...rejected]);
  return required.filter(id => !decided.has(id));
}

/**
 * Whether the transaction is in a terminal state.
 */
export function isTxTerminal(status: SyncTransactionStatus): boolean {
  return SYNC_TX_TRANSITIONS[status].length === 0;
}

/**
 * Whether the transaction is blocking (agent cannot resume).
 */
export function isTxBlocking(status: SyncTransactionStatus): boolean {
  return (
    status === SyncTransactionStatus.OPEN ||
    status === SyncTransactionStatus.WAITING_APPROVAL ||
    status === SyncTransactionStatus.REJECTED
  );
}
