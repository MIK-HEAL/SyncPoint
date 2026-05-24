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
  evaluateConstraints,
  EventType,
} from "syncpoint-core";
import type { Operation, OperationCreate, OperationCheckItem, OperationCheckResult, ResourceRef, ConstraintViolation } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { buildProjection } from "./reality-projection-service.js";

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

  // Run Constraint Runtime evaluation
  const constraintViolations = runConstraintCheck(operation, "operation_submit");

  if (constraintViolations.length > 0) {
    items.push({
      check: "constraint_runtime",
      passed: false,
      detail: `Blocked by ${constraintViolations.length} constraint violation(s): ${constraintViolations.map(v => v.rule).join(", ")}`,
    });
  }

  const allPassed = items.every(i => i.passed);

  const checkResult: OperationCheckResult = {
    allPassed,
    items,
    targetResources: operation.targetResources,
    uncoveredResources: [],
    conflictingClaimIds: [],
    ...(constraintViolations.length > 0 ? { constraintViolations } : {}),
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
 * Runs a final constraint check (action: "operation_apply") before allowing apply.
 */
export function opApply(operationId: string): Operation {
  const operation = repo.getOperation(operationId);

  if (!validateOperationTransition(operation.status, OperationStatus.APPLIED)) {
    throw new Error(`Cannot apply operation ${operationId} from ${operation.status}`);
  }

  // Final constraint check before apply
  const violations = runConstraintCheck(operation, "operation_apply");
  if (violations.length > 0) {
    throw new Error(
      `Cannot apply operation ${operationId}: blocked by constraint runtime — ${violations.map(v => v.message).join("; ")}`,
    );
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

// ── Constraint Runtime Helper ─────────────────────────

/**
 * Run constraint runtime evaluation for an operation.
 * Returns blockers (empty array = no violations).
 * Fail-closed: returns a synthetic blocker when projection is unavailable.
 */
function runConstraintCheck(
  operation: Operation,
  action: "operation_submit" | "operation_apply",
): ConstraintViolation[] {
  try {
    const touchedResources = operation.targetResources;
    if (!touchedResources.length) return [];

    const projection = buildProjection({
      taskId: operation.taskId,
      workingResources: touchedResources.map(r => r.locator),
    });

    const decision = evaluateConstraints({
      action,
      projection,
      touchedResources,
    });

    return decision.blockers;
  } catch (err) {
    // Fail-closed: projection unavailable — block operation
    return [{
      rule: "projection_unavailable",
      sourceMemoryId: "",
      projectionId: "",
      message: `Cannot evaluate constraints: projection unavailable (${err instanceof Error ? err.message : "unknown error"})`,
    }];
  }
}
