/**
 * CheckpointReview Service — checkpoint-driven approval reviews.
 *
 * Use cases:
 *   stxCreate   — create a checkpoint review + bound SyncGate
 *   stxSubmit   — move OPEN → WAITING_APPROVAL
 *   stxApprove  — approver approves
 *   stxReject   — approver rejects
 *   stxResolve  — resolve review + release gate
 *   stxCancel   — cancel review + cancel gate
 *   stxStatus   — get review status with pending info
 *   stxList     — list reviews with optional filters
 *
 * Public function names keep the `stx*` prefix for transport-layer stability.
 */

import {
  CheckpointReviewStatus,
  SyncGateReason,
  EventType,
  validateCheckpointReviewTransition,
  allApproved,
  hasRejection,
  pendingApprovers,
  isReviewBlocking,
} from "syncpoint-core";
import type { CheckpointReview } from "syncpoint-core";
import * as protocolRepo from "../repositories/_exports/protocol.js";
import { logEvent } from "../repositories/_shared.js";
import { sgRequest, sgAck, sgResolve, sgCancel } from "./sync-gate-service.js";

// ── Types ──────────────────────────────────────────────

export interface SyncTxCreateInput {
  sessionId: string;
  taskId: string;
  checkpointId: string;
  requestingAgentId: string;
  requiredApproverIds: string[];
}

export interface SyncTxStatusResult {
  tx: CheckpointReview;
  pending: string[];
  allApproved: boolean;
  hasRejection: boolean;
  isBlocking: boolean;
}

// ── Use Cases ──────────────────────────────────────────

/**
 * Create a sync transaction. Automatically creates a bound SyncGate
 * with reason=checkpoint_required and moves the transaction to WAITING_APPROVAL.
 */
export function stxCreate(input: SyncTxCreateInput): SyncTxStatusResult {
  // 1. Create bound SyncGate
  const gateResult = sgRequest({
    sessionId: input.sessionId,
    taskId: input.taskId,
    requestedByAgentId: input.requestingAgentId,
    requiredAgentIds: input.requiredApproverIds,
    reason: SyncGateReason.CHECKPOINT_REQUIRED,
    description: `Sync transaction for checkpoint ${input.checkpointId}`,
    relatedCheckpointId: input.checkpointId,
  });

  // 2. Create the transaction
  let tx = protocolRepo.createCheckpointReview({
    sessionId: input.sessionId,
    taskId: input.taskId,
    checkpointId: input.checkpointId,
    requestingAgentId: input.requestingAgentId,
    requiredApproverIds: input.requiredApproverIds,
    gateId: gateResult.gate.id,
  });

  logEvent(
    EventType.SYNC_TX_CREATED,
    "checkpoint_review",
    tx.id,
    JSON.stringify({
      sessionId: input.sessionId,
      taskId: input.taskId,
      checkpointId: input.checkpointId,
      requiredApproverIds: input.requiredApproverIds,
      gateId: gateResult.gate.id,
    }),
  );

  // 3. Auto-advance to WAITING_APPROVAL
  tx = protocolRepo.updateCheckpointReviewStatus(tx.id, CheckpointReviewStatus.WAITING_APPROVAL);

  logEvent(
    EventType.SYNC_TX_SUBMITTED,
    "checkpoint_review",
    tx.id,
    JSON.stringify({ requiredApproverIds: input.requiredApproverIds }),
  );

  return buildStatusResult(tx);
}

/**
 * Approver approves a sync transaction.
 */
export function stxApprove(txId: string, agentId: string, summary?: string): SyncTxStatusResult {
  let tx = protocolRepo.getCheckpointReview(txId);

  // Verify agent is required approver
  const required = tx.requiredApproverIds;
  if (!required.includes(agentId)) {
    throw new Error(`Agent ${agentId} is not a required approver for transaction ${txId}`);
  }

  // Verify transaction is in WAITING_APPROVAL
  if (tx.status !== CheckpointReviewStatus.WAITING_APPROVAL) {
    throw new Error(`Transaction ${txId} is not in WAITING_APPROVAL state (currently ${tx.status})`);
  }

  // Add to approved list
  const approved = tx.approvedByIds;
  if (!approved.includes(agentId)) {
    tx = protocolRepo.approveCheckpointReviewBy(tx.id, agentId);
  }

  logEvent(
    EventType.SYNC_TX_APPROVED,
    "checkpoint_review",
    tx.id,
    JSON.stringify({ agentId, summary: summary ?? "" }),
  );

  // Ack the bound gate so it can advance
  if (tx.gateId) {
    try { sgAck(tx.gateId, agentId, `Approved: ${summary ?? ""}`); } catch { /* already acked or gate state mismatch */ }
  }

  // Auto-advance to APPROVED when all have approved
  if (allApproved(tx)) {
    tx = protocolRepo.updateCheckpointReviewStatus(tx.id, CheckpointReviewStatus.APPROVED, summary ?? "");
  }

  return buildStatusResult(tx);
}

/**
 * Approver rejects a sync transaction.
 */
export function stxReject(txId: string, agentId: string, reason?: string): SyncTxStatusResult {
  let tx = protocolRepo.getCheckpointReview(txId);

  // Verify agent is required approver
  const required = tx.requiredApproverIds;
  if (!required.includes(agentId)) {
    throw new Error(`Agent ${agentId} is not a required approver for transaction ${txId}`);
  }

  // Verify transaction is in WAITING_APPROVAL
  if (tx.status !== CheckpointReviewStatus.WAITING_APPROVAL) {
    throw new Error(`Transaction ${txId} is not in WAITING_APPROVAL state (currently ${tx.status})`);
  }

  // Add to rejected list
  const rejected = tx.rejectedByIds;
  if (!rejected.includes(agentId)) {
    tx = protocolRepo.rejectCheckpointReviewBy(tx.id, agentId);
  }

  logEvent(
    EventType.SYNC_TX_REJECTED,
    "checkpoint_review",
    tx.id,
    JSON.stringify({ agentId, reason: reason ?? "" }),
  );

  // Ack the bound gate so it can advance (rejection still means the approver has reviewed)
  if (tx.gateId) {
    try { sgAck(tx.gateId, agentId, `Rejected: ${reason ?? ""}`); } catch { /* already acked or gate state mismatch */ }
  }

  // Move to REJECTED immediately on first rejection
  tx = protocolRepo.updateCheckpointReviewStatus(tx.id, CheckpointReviewStatus.REJECTED, reason ?? "");

  return buildStatusResult(tx);
}

/**
 * Resolve a sync transaction → RESOLVED and release the bound SyncGate.
 * Can be called after APPROVED (normal flow) or REJECTED (after follow-up).
 */
export function stxResolve(txId: string, decisionSummary?: string): SyncTxStatusResult {
  let tx = protocolRepo.getCheckpointReview(txId);

  if (!validateCheckpointReviewTransition(tx.status as CheckpointReviewStatus, CheckpointReviewStatus.RESOLVED)) {
    throw new Error(`Cannot resolve transaction ${txId} from ${tx.status}`);
  }

  tx = protocolRepo.updateCheckpointReviewStatus(tx.id, CheckpointReviewStatus.RESOLVED, decisionSummary ?? "");

  logEvent(
    EventType.SYNC_TX_RESOLVED,
    "checkpoint_review",
    tx.id,
    JSON.stringify({ decisionSummary: decisionSummary ?? "" }),
  );

  // Release the bound SyncGate
  if (tx.gateId) {
    try {
      sgResolve(tx.gateId, `Transaction ${tx.id} resolved: ${decisionSummary ?? ""}`);
    } catch {
      // Gate may already be resolved/cancelled
    }
  }

  return buildStatusResult(tx);
}

/**
 * Cancel a sync transaction and its bound SyncGate.
 */
export function stxCancel(txId: string, reason?: string): CheckpointReview {
  let tx = protocolRepo.getCheckpointReview(txId);

  if (!validateCheckpointReviewTransition(tx.status as CheckpointReviewStatus, CheckpointReviewStatus.CANCELLED)) {
    throw new Error(`Cannot cancel transaction ${txId} from ${tx.status}`);
  }

  tx = protocolRepo.updateCheckpointReviewStatus(tx.id, CheckpointReviewStatus.CANCELLED, reason ?? "");

  logEvent(
    EventType.SYNC_TX_CANCELLED,
    "checkpoint_review",
    tx.id,
    JSON.stringify({ reason: reason ?? "" }),
  );

  // Cancel the bound SyncGate
  if (tx.gateId) {
    try {
      sgCancel(tx.gateId, `Transaction ${tx.id} cancelled: ${reason ?? ""}`);
    } catch {
      // Gate may already be resolved/cancelled
    }
  }

  return tx;
}

/**
 * Get detailed transaction status.
 */
export function stxStatus(txId: string): SyncTxStatusResult {
  const tx = protocolRepo.getCheckpointReview(txId);
  return buildStatusResult(tx);
}

/**
 * List sync transactions with optional filters.
 */
export function stxList(opts?: {
  sessionId?: string;
  taskId?: string;
  status?: string;
}): CheckpointReview[] {
  return protocolRepo.listCheckpointReviews(opts);
}

/**
 * List active (blocking) sync transactions.
 */
export function stxListActive(opts?: {
  sessionId?: string;
  taskId?: string;
}): CheckpointReview[] {
  return protocolRepo.listActiveCheckpointReviews(opts);
}

// ── Internal ───────────────────────────────────────────

function buildStatusResult(tx: CheckpointReview): SyncTxStatusResult {
  const status = tx.status as CheckpointReviewStatus;
  return {
    tx,
    pending: pendingApprovers(tx),
    allApproved: allApproved(tx),
    hasRejection: hasRejection(tx),
    isBlocking: isReviewBlocking(status),
  };
}
