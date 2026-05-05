/**
 * Validator — generic validation protocol for operations and resources.
 *
 * Provides a pluggable validation interface that the constraint runtime
 * and operation checkers can consume. Specific validators (file overlap,
 * diff format, claim coverage) are registered by resource/operation plugins.
 */

import type { ResourceClaim } from "./resource.js";
import type { Operation, OperationCheckItem } from "./operation.js";

// ── Validator interface ─────────────────────────────

/**
 * A validator checks an operation against some criteria and returns check items.
 */
export interface OperationValidator {
  /** Unique name, e.g. "file_claim_conflict", "code_patch_format" */
  name: string;
  /** Operation types this validator applies to (empty = all) */
  operationTypes: string[];
  /** Resource types this validator applies to (empty = all) */
  resourceTypes: string[];
  /** Run validation and return check items */
  validate(ctx: OperationValidationContext): OperationCheckItem[];
}

/**
 * Context provided to validators during operation check.
 */
export interface OperationValidationContext {
  operation: Operation;
  /** Active claims belonging to the operation's actor */
  actorClaims: ResourceClaim[];
  /** All active claims across all actors */
  allActiveClaims: ResourceClaim[];
  /** Payload content (e.g. patch text) — may be empty */
  payload?: string;
}

// ── Validator Registry ──────────────────────────────

const _validators: OperationValidator[] = [];

/**
 * Register a validator for operation checks.
 */
export function registerOperationValidator(v: OperationValidator): void {
  _validators.push(v);
}

/**
 * Get all registered validators applicable to a given operation type.
 */
export function getValidatorsForOperation(
  operationType: string,
  resourceTypes?: string[],
): OperationValidator[] {
  const shouldFilterResources = resourceTypes !== undefined;
  const resourceTypeSet = new Set(resourceTypes ?? []);
  return _validators.filter(v => {
    const operationMatches = v.operationTypes.length === 0 || v.operationTypes.includes(operationType);
    if (!operationMatches) return false;

    if (!shouldFilterResources) return true;
    if (v.resourceTypes.length === 0) return true;
    if (resourceTypeSet.size === 0) return false;
    return v.resourceTypes.some(type => resourceTypeSet.has(type));
  });
}

/**
 * Run all applicable validators for an operation.
 */
export function runOperationValidation(ctx: OperationValidationContext): OperationCheckItem[] {
  const resourceTypes = [...new Set(ctx.operation.targetResources.map(r => r.type))];
  const validators = getValidatorsForOperation(ctx.operation.type, resourceTypes);
  const items: OperationCheckItem[] = [];
  for (const v of validators) {
    items.push(...v.validate(ctx));
  }
  return items;
}

/**
 * Clear all registered validators (for testing).
 */
export function clearValidatorRegistry(): void {
  _validators.length = 0;
}
