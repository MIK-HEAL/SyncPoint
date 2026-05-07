/**
 * Generic agent OperationValidators — three protocol-level checks
 * that apply to all generic operation and resource types.
 *
 * 1. generic_claim_coverage  — target resources must be claimed by actor
 * 2. generic_no_hard_conflict — no exclusive overlap with other actors
 * 3. generic_payload_present — warn if no payload or payloadRef is supplied
 */

import type {
  OperationValidator,
  OperationValidationContext,
  OperationCheckItem,
  ResourceRef,
  ResourceClaimMode,
} from "syncpoint-core";
import { resourceLocatorsOverlap } from "syncpoint-core";
import { GENERIC_OPERATION_TYPES } from "./operation-types.js";
import { GENERIC_RESOURCE_TYPES } from "./resource-types.js";

// ── Helpers ──────────────────────────────────────────

function isGenericResource(type: string): boolean {
  return (GENERIC_RESOURCE_TYPES as readonly string[]).includes(type);
}

/** Get target ResourceRefs that are generic types. */
function genericTargetRefs(ctx: OperationValidationContext): ResourceRef[] {
  return ctx.operation.targetResources
    .filter(r => isGenericResource(r.type));
}

/** Get all claimed ResourceRefs (generic types) for the actor. */
function claimedRefs(ctx: OperationValidationContext): ResourceRef[] {
  return ctx.actorClaims
    .flatMap(c => c.resources)
    .filter(r => isGenericResource(r.type));
}

// ── Validators ───────────────────────────────────────

/**
 * Check that every generic target resource is covered by an active claim.
 */
export const genericClaimCoverageValidator: OperationValidator = {
  name: "generic_claim_coverage",
  operationTypes: [...GENERIC_OPERATION_TYPES],
  resourceTypes: [...GENERIC_RESOURCE_TYPES],
  validate(ctx: OperationValidationContext): OperationCheckItem[] {
    const targets = genericTargetRefs(ctx);
    if (targets.length === 0) {
      return [{ check: "generic_claim_coverage", passed: true, detail: "No generic resources to check" }];
    }

    const claimed = claimedRefs(ctx);
    const uncovered = targets.filter(t =>
      !claimed.some(c => resourceLocatorsOverlap(t, c)),
    );

    return [{
      check: "generic_claim_coverage",
      passed: uncovered.length === 0,
      detail: uncovered.length === 0
        ? "All target resources are covered by actor's active claims"
        : `Uncovered resources: ${uncovered.map(r => r.locator).join(", ")}`,
    }];
  },
};

/**
 * Check that no other actor's exclusive claim overlaps the target resources.
 */
export const genericNoHardConflictValidator: OperationValidator = {
  name: "generic_no_hard_conflict",
  operationTypes: [...GENERIC_OPERATION_TYPES],
  resourceTypes: [...GENERIC_RESOURCE_TYPES],
  validate(ctx: OperationValidationContext): OperationCheckItem[] {
    const targets = genericTargetRefs(ctx);
    if (targets.length === 0) {
      return [{ check: "generic_no_hard_conflict", passed: true, detail: "No generic resources to check" }];
    }

    const otherExclusive = ctx.allActiveClaims.filter(
      c => c.actorId !== ctx.operation.actorId && c.mode === ("exclusive" as ResourceClaimMode),
    );
    const conflicting = otherExclusive.filter(c =>
      c.resources.some(r =>
        isGenericResource(r.type) && targets.some(t => resourceLocatorsOverlap(t, r)),
      ),
    );

    return [{
      check: "generic_no_hard_conflict",
      passed: conflicting.length === 0,
      detail: conflicting.length === 0
        ? "No conflicting exclusive claims from other actors"
        : `Conflicts with ${conflicting.length} claim(s): ${conflicting.map(c => c.id).join(", ")}`,
    }];
  },
};

/**
 * Soft check: warn if operation payload is empty (no content supplied).
 * This is a lightweight "did you forget the payload?" guard, not semantic validation.
 */
export const genericPayloadPresentValidator: OperationValidator = {
  name: "generic_payload_present",
  operationTypes: [...GENERIC_OPERATION_TYPES],
  resourceTypes: [...GENERIC_RESOURCE_TYPES],
  validate(ctx: OperationValidationContext): OperationCheckItem[] {
    const hasPayload = !!ctx.payload && ctx.payload.trim().length > 0;
    const hasPayloadRef = !!ctx.operation.payloadRef && ctx.operation.payloadRef.trim().length > 0;
    const present = hasPayload || hasPayloadRef;
    return [{
      check: "generic_payload_present",
      passed: present,
      detail: present
        ? "Operation has payload or payloadRef"
        : "Operation has no payload and no payloadRef — is this intentional?",
    }];
  },
};

/**
 * All generic agent validators.
 */
export const GENERIC_VALIDATORS: OperationValidator[] = [
  genericClaimCoverageValidator,
  genericNoHardConflictValidator,
  genericPayloadPresentValidator,
];
