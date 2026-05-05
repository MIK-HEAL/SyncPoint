/**
 * Operation Service — generic operation lifecycle management.
 *
 * Use cases:
 *   opCreate   — create a draft operation
 *   opSubmit   — submit for checking (DRAFT → SUBMITTED)
 *   opCheck    — run validators
 *   opApprove  — approve a submitted operation
 *   opReject   — reject a submitted operation
 *   opApply    — mark an approved operation as applied
 *   opCancel   — cancel an operation
 *   opStatus   — get operation with check result
 *   opList     — list operations with filters
 */

import {
  OperationStatus,
  validateOperationTransition,
  runOperationValidation,
  EventType,
} from "syncpoint-core";
import type { Operation, OperationCreate, OperationCheckItem, OperationCheckResult, ResourceRef } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";

// ── Types ──────────────────────────────────────────────

export interface OperationCreateInput {
  type: string;
  actorId: string;
  taskId: string;
  sessionId?: string;
  title: string;
  summary?: string;
  targetResources?: ResourceRef[];
  payloadRef?: string;
}

export interface OperationStatusResult {
  operation: Operation;
  checkResult: OperationCheckResult | null;
}

// ── Use Cases ──────────────────────────────────────────

/**
 * Create a draft operation.
 */
export function opCreate(input: OperationCreateInput): Operation {
  const operation = repo.createOperation({
    type: input.type,
    actorId: input.actorId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    title: input.title,
    summary: input.summary ?? "",
    targetResources: input.targetResources ?? [],
    payloadRef: input.payloadRef ?? "",
  });

  logEvent(
    EventType.OPERATION_CREATED,
    "operation",
    operation.id,
    JSON.stringify({ type: input.type, title: input.title }),
  );

  return operation;
}

/**
 * Submit a draft operation for checking (DRAFT → SUBMITTED).
 * Automatically runs validators.
 */
export function opSubmit(operationId: string): OperationStatusResult {
  let operation = repo.getOperation(operationId);

  if (!validateOperationTransition(operation.status, OperationStatus.SUBMITTED)) {
    throw new Error(`Cannot submit operation ${operationId} from ${operation.status}`);
  }

  operation = repo.updateOperation(operationId, {
    status: OperationStatus.SUBMITTED,
  });

  logEvent(EventType.OPERATION_SUBMITTED, "operation", operationId, "");

  return opCheck(operationId);
}

/**
 * Run validators on an operation.
 */
export function opCheck(operationId: string): OperationStatusResult {
  const operation = repo.getOperation(operationId);

  // Collect claims for the actor
  const actorClaims = repo.listActiveResourceClaims({
    sessionId: operation.sessionId || undefined,
  }).filter(c => c.actorId === operation.actorId);

  const allActiveClaims = repo.listActiveResourceClaims({
    sessionId: operation.sessionId || undefined,
  });

  const items = runOperationValidation({
    operation,
    actorClaims,
    allActiveClaims,
  });

  const allPassed = items.every(i => i.passed);

  const checkResult: OperationCheckResult = {
    allPassed,
    items,
    targetResources: operation.targetResources,
    uncoveredResources: [],
    conflictingClaimIds: [],
  };

  // Auto-move to CONFLICTING if checks fail
  let status = operation.status;
  if (!allPassed && operation.status === OperationStatus.SUBMITTED) {
    status = OperationStatus.CONFLICTING;
  }

  const updated = repo.updateOperation(operationId, {
    checkResult: JSON.stringify(checkResult),
    status,
  });

  logEvent(
    EventType.OPERATION_CHECKED,
    "operation",
    operationId,
    JSON.stringify({ allPassed }),
  );

  return { operation: updated, checkResult };
}

/**
 * Approve a submitted operation.
 */
export function opApprove(operationId: string, actorId: string, summary?: string): Operation {
  const operation = repo.getOperation(operationId);

  if (!validateOperationTransition(operation.status, OperationStatus.APPROVED)) {
    throw new Error(`Cannot approve operation ${operationId} from ${operation.status}`);
  }

  const updated = repo.updateOperation(operationId, {
    status: OperationStatus.APPROVED,
    decisionSummary: summary ?? `Approved by ${actorId}`,
  });

  logEvent(
    EventType.OPERATION_APPROVED,
    "operation",
    operationId,
    JSON.stringify({ actorId, summary: summary ?? "" }),
  );

  return updated;
}

/**
 * Reject a submitted operation.
 */
export function opReject(operationId: string, actorId: string, reason?: string): Operation {
  const operation = repo.getOperation(operationId);

  if (!validateOperationTransition(operation.status, OperationStatus.REJECTED)) {
    throw new Error(`Cannot reject operation ${operationId} from ${operation.status}`);
  }

  const updated = repo.updateOperation(operationId, {
    status: OperationStatus.REJECTED,
    decisionSummary: reason ?? `Rejected by ${actorId}`,
  });

  logEvent(
    EventType.OPERATION_REJECTED,
    "operation",
    operationId,
    JSON.stringify({ actorId, reason: reason ?? "" }),
  );

  return updated;
}

/**
 * Mark an approved operation as applied.
 */
export function opApply(operationId: string): Operation {
  const operation = repo.getOperation(operationId);

  if (!validateOperationTransition(operation.status, OperationStatus.APPLIED)) {
    throw new Error(`Cannot apply operation ${operationId} from ${operation.status}`);
  }

  const updated = repo.updateOperation(operationId, {
    status: OperationStatus.APPLIED,
  });

  logEvent(EventType.OPERATION_APPLIED, "operation", operationId, "");
  return updated;
}

/**
 * Cancel an operation.
 */
export function opCancel(operationId: string, reason?: string): Operation {
  const operation = repo.getOperation(operationId);

  if (!validateOperationTransition(operation.status, OperationStatus.CANCELLED)) {
    throw new Error(`Cannot cancel operation ${operationId} from ${operation.status}`);
  }

  const updated = repo.updateOperation(operationId, {
    status: OperationStatus.CANCELLED,
    decisionSummary: reason ?? "",
  });

  logEvent(EventType.OPERATION_CANCELLED, "operation", operationId, reason ?? "");
  return updated;
}

/**
 * Get operation status with parsed check result.
 */
export function opStatus(operationId: string): OperationStatusResult {
  const operation = repo.getOperation(operationId);
  let checkResult: OperationCheckResult | null = null;
  if (operation.checkResult) {
    try { checkResult = JSON.parse(operation.checkResult); } catch { /* invalid JSON */ }
  }
  return { operation, checkResult };
}

/**
 * List operations with optional filters.
 */
export function opList(opts?: {
  type?: string;
  actorId?: string;
  taskId?: string;
  sessionId?: string;
  status?: string;
}): Operation[] {
  return repo.listOperations(opts);
}
