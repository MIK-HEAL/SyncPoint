/**
 * SyncTransaction Service — checkpoint-driven synchronization transactions.
 *
 * Use cases:
 *   stxCreate   — create a sync transaction + bound SyncGate
 *   stxSubmit   — move OPEN → WAITING_APPROVAL
 *   stxApprove  — approver approves
 *   stxReject   — approver rejects
 *   stxResolve  — resolve transaction + release gate
 *   stxCancel   — cancel transaction + cancel gate
 *   stxStatus   — get transaction status with pending info
 *   stxList     — list transactions with optional filters
 */

import {
  CheckpointReviewStatus,
  SyncGateReason,
  EventType,
  validateCheckpointReviewTransition,
  parseIdListCsv,
  allApproved,
  hasRejection,
  pendingApprovers,
} from "syncpoint-core";
import type { CheckpointReview } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { sgRequest, sgAck, sgResolve, sgCancel } from "./sync-gate-service.js";

// Compat aliases
const SyncTransactionStatus = CheckpointReviewStatus;
type SyncTransaction = CheckpointReview;
const validateSyncTxTransition = validateCheckpointReviewTransition;
const parseTxIdList = parseIdListCsv;

// ── Types ──────────────────────────────────────────────

export interface SyncTxCreateInput {
  sessionId: string;
  taskId: string;
  checkpointId: string;
  requestingAgentId: string;
  requiredApproverIds: string[];
}

export interface SyncTxStatusResult {
  tx: SyncTransaction;
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
  let tx = repo.createSyncTransaction({
    sessionId: input.sessionId,
    taskId: input.taskId,
    checkpointId: input.checkpointId,
    requestingAgentId: input.requestingAgentId,
    requiredApproverIds: input.requiredApproverIds,
    gateId: gateResult.gate.id,
  });

  logEvent(
    EventType.SYNC_TX_CREATED,
    "sync_transaction",
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
  tx = repo.updateSyncTransactionStatus(tx.id, SyncTransactionStatus.WAITING_APPROVAL);

  logEvent(
    EventType.SYNC_TX_SUBMITTED,
    "sync_transaction",
    tx.id,
    JSON.stringify({ requiredApproverIds: input.requiredApproverIds }),
  );

  return buildStatusResult(tx);
}

/**
 * Approver approves a sync transaction.
 */
export function stxApprove(txId: string, agentId: string, summary?: string): SyncTxStatusResult {
  let tx = repo.getSyncTransaction(txId);

  // Verify agent is required approver
  const required = parseTxIdList(tx.requiredApproverIds);
  if (!required.includes(agentId)) {
    throw new Error(`Agent ${agentId} is not a required approver for transaction ${txId}`);
  }

  // Verify transaction is in WAITING_APPROVAL
  if (tx.status !== SyncTransactionStatus.WAITING_APPROVAL) {
    throw new Error(`Transaction ${txId} is not in WAITING_APPROVAL state (currently ${tx.status})`);
  }

  // Add to approved list
  const approved = parseTxIdList(tx.approvedByIds);
  if (!approved.includes(agentId)) {
    approved.push(agentId);
    tx = repo.updateSyncTransactionApprovedBy(tx.id, approved.join(","));
  }

  logEvent(
    EventType.SYNC_TX_APPROVED,
    "sync_transaction",
    tx.id,
    JSON.stringify({ agentId, summary: summary ?? "" }),
  );

  // Ack the bound gate so it can advance
  if (tx.gateId) {
    try { sgAck(tx.gateId, agentId, `Approved: ${summary ?? ""}`); } catch { /* already acked or gate state mismatch */ }
  }

  // Auto-advance to APPROVED when all have approved
  if (allApproved(tx)) {
    tx = repo.updateSyncTransactionStatus(tx.id, SyncTransactionStatus.APPROVED, summary ?? "");
  }

  return buildStatusResult(tx);
}

/**
 * Approver rejects a sync transaction.
 */
export function stxReject(txId: string, agentId: string, reason?: string): SyncTxStatusResult {
  let tx = repo.getSyncTransaction(txId);

  // Verify agent is required approver
  const required = parseTxIdList(tx.requiredApproverIds);
  if (!required.includes(agentId)) {
    throw new Error(`Agent ${agentId} is not a required approver for transaction ${txId}`);
  }

  // Verify transaction is in WAITING_APPROVAL
  if (tx.status !== SyncTransactionStatus.WAITING_APPROVAL) {
    throw new Error(`Transaction ${txId} is not in WAITING_APPROVAL state (currently ${tx.status})`);
  }

  // Add to rejected list
  const rejected = parseTxIdList(tx.rejectedByIds);
  if (!rejected.includes(agentId)) {
    rejected.push(agentId);
    tx = repo.updateSyncTransactionRejectedBy(tx.id, rejected.join(","));
  }

  logEvent(
    EventType.SYNC_TX_REJECTED,
    "sync_transaction",
    tx.id,
    JSON.stringify({ agentId, reason: reason ?? "" }),
  );

  // Ack the bound gate so it can advance (rejection still means the approver has reviewed)
  if (tx.gateId) {
    try { sgAck(tx.gateId, agentId, `Rejected: ${reason ?? ""}`); } catch { /* already acked or gate state mismatch */ }
  }

  // Move to REJECTED immediately on first rejection
  tx = repo.updateSyncTransactionStatus(tx.id, SyncTransactionStatus.REJECTED, reason ?? "");

  return buildStatusResult(tx);
}

/**
 * Resolve a sync transaction → RESOLVED and release the bound SyncGate.
 * Can be called after APPROVED (normal flow) or REJECTED (after follow-up).
 */
export function stxResolve(txId: string, decisionSummary?: string): SyncTxStatusResult {
  let tx = repo.getSyncTransaction(txId);

  if (!validateSyncTxTransition(tx.status as CheckpointReviewStatus, SyncTransactionStatus.RESOLVED)) {
    throw new Error(`Cannot resolve transaction ${txId} from ${tx.status}`);
  }

  tx = repo.updateSyncTransactionStatus(tx.id, SyncTransactionStatus.RESOLVED, decisionSummary ?? "");

  logEvent(
    EventType.SYNC_TX_RESOLVED,
    "sync_transaction",
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
export function stxCancel(txId: string, reason?: string): SyncTransaction {
  let tx = repo.getSyncTransaction(txId);

  if (!validateSyncTxTransition(tx.status as CheckpointReviewStatus, SyncTransactionStatus.CANCELLED)) {
    throw new Error(`Cannot cancel transaction ${txId} from ${tx.status}`);
  }

  tx = repo.updateSyncTransactionStatus(tx.id, SyncTransactionStatus.CANCELLED, reason ?? "");

  logEvent(
    EventType.SYNC_TX_CANCELLED,
    "sync_transaction",
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
  const tx = repo.getSyncTransaction(txId);
  return buildStatusResult(tx);
}

/**
 * List sync transactions with optional filters.
 */
export function stxList(opts?: {
  sessionId?: string;
  taskId?: string;
  status?: string;
}): SyncTransaction[] {
  return repo.listSyncTransactions(opts);
}

/**
 * List active (blocking) sync transactions.
 */
export function stxListActive(opts?: {
  sessionId?: string;
  taskId?: string;
}): SyncTransaction[] {
  return repo.listActiveSyncTransactions(opts);
}

// ── Internal ───────────────────────────────────────────

function buildStatusResult(tx: SyncTransaction): SyncTxStatusResult {
  const status = tx.status as CheckpointReviewStatus;
  return {
    tx,
    pending: pendingApprovers(tx),
    allApproved: allApproved(tx),
    hasRejection: hasRejection(tx),
    isBlocking:
      status === SyncTransactionStatus.OPEN ||
      status === SyncTransactionStatus.WAITING_APPROVAL ||
      status === SyncTransactionStatus.REJECTED,
  };
}
