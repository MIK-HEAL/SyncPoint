/**
 * CheckpointReview — checkpoint-driven approval flow.
 *
 * A CheckpointReview wraps a checkpoint into a formal approval flow:
 *
 *   checkpoint --need-sync
 *     → create CheckpointReview (OPEN)
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

export enum CheckpointReviewStatus {
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

export const CHECKPOINT_REVIEW_TRANSITIONS: Record<CheckpointReviewStatus, CheckpointReviewStatus[]> = {
  [CheckpointReviewStatus.OPEN]: [
    CheckpointReviewStatus.WAITING_APPROVAL,
    CheckpointReviewStatus.CANCELLED,
  ],
  [CheckpointReviewStatus.WAITING_APPROVAL]: [
    CheckpointReviewStatus.APPROVED,
    CheckpointReviewStatus.REJECTED,
    CheckpointReviewStatus.CANCELLED,
  ],
  [CheckpointReviewStatus.APPROVED]: [
    CheckpointReviewStatus.RESOLVED,
    CheckpointReviewStatus.CANCELLED,
  ],
  [CheckpointReviewStatus.REJECTED]: [
    CheckpointReviewStatus.RESOLVED,
    CheckpointReviewStatus.CANCELLED,
  ],
  [CheckpointReviewStatus.RESOLVED]: [],
  [CheckpointReviewStatus.CANCELLED]: [],
};

export function validateCheckpointReviewTransition(from: CheckpointReviewStatus, to: CheckpointReviewStatus): boolean {
  return CHECKPOINT_REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Schema ──────────────────────────────────────────

export const CheckpointReviewSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
  checkpointId: z.string(),
  requestingAgentId: z.string(),
  /** Comma-separated agent IDs that must approve */
  requiredApproverIds: z.array(z.string()).min(1),
  /** Comma-separated agent IDs that have approved */
  approvedByIds: z.array(z.string()).default([]),
  /** Comma-separated agent IDs that have rejected */
  rejectedByIds: z.array(z.string()).default([]),
  /** Bound SyncGate ID (created automatically) */
  gateId: z.string(),
  status: z.nativeEnum(CheckpointReviewStatus),
  decisionSummary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CheckpointReview = z.infer<typeof CheckpointReviewSchema>;

export const CheckpointReviewCreateSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
  checkpointId: z.string(),
  requestingAgentId: z.string(),
  requiredApproverIds: z.array(z.string()).min(1),
});

export type CheckpointReviewCreate = z.infer<typeof CheckpointReviewCreateSchema>;

// ── Pure helpers ────────────────────────────────────

/**
 * Check if all required approvers have approved.
 */
export function allApproved(review: CheckpointReview): boolean {
  const approved = new Set(review.approvedByIds);
  return review.requiredApproverIds.length > 0 && review.requiredApproverIds.every(id => approved.has(id));
}

/**
 * Check if any approver has rejected.
 */
export function hasRejection(review: CheckpointReview): boolean {
  return review.rejectedByIds.length > 0;
}

/**
 * List approvers who have not yet decided.
 */
export function pendingApprovers(review: CheckpointReview): string[] {
  const decided = new Set([...review.approvedByIds, ...review.rejectedByIds]);
  return review.requiredApproverIds.filter(id => !decided.has(id));
}

/**
 * Whether the review is in a terminal state.
 */
export function isReviewTerminal(status: CheckpointReviewStatus): boolean {
  return CHECKPOINT_REVIEW_TRANSITIONS[status].length === 0;
}

/**
 * Whether the review is blocking (agent cannot resume).
 */
export function isReviewBlocking(status: CheckpointReviewStatus): boolean {
  return (
    status === CheckpointReviewStatus.OPEN ||
    status === CheckpointReviewStatus.WAITING_APPROVAL ||
    status === CheckpointReviewStatus.REJECTED
  );
}



