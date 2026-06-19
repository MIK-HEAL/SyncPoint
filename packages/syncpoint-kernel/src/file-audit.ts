import { resourceLocatorsOverlap, ResourceClaimMode } from "./resource.js";
import type { ResourceClaim, ResourceRef } from "./resource.js";

export enum FileAuditDecisionKind {
  FILE_CHANGED = "file_changed",
  CLAIMED_WRITE = "claimed_write",
  FILE_POLLUTION_DETECTED = "file_pollution_detected",
  FILE_AUDIT_ALERT = "file_audit_alert",
}

export interface FileAuditGateContext {
  id: string;
  relatedFiles?: string[];
  relatedResources?: ResourceRef[];
}

export interface FileAuditInput {
  actorId: string;
  changedResource: ResourceRef;
  activeClaims: ResourceClaim[];
  blockingGates?: FileAuditGateContext[];
}

export interface FileAuditDecision {
  kind: FileAuditDecisionKind;
  changedResource: ResourceRef;
  ownClaims: ResourceClaim[];
  conflictingClaims: ResourceClaim[];
  relatedBlockingGateIds: string[];
  shouldCreateGate: boolean;
}

export function evaluateFileAuditChange(input: FileAuditInput): FileAuditDecision {
  const matchingClaims = findMatchingClaims(input.activeClaims, input.changedResource);
  const ownClaims = matchingClaims.filter(claim => claim.actorId === input.actorId);
  const conflictingClaims = matchingClaims.filter(
    claim => claim.actorId !== input.actorId && claim.mode === ResourceClaimMode.EXCLUSIVE,
  );
  const relatedBlockingGateIds = (input.blockingGates ?? [])
    .filter(gate => gateMatchesResource(gate, input.changedResource))
    .map(gate => gate.id);

  if (relatedBlockingGateIds.length > 0) {
    return {
      kind: FileAuditDecisionKind.FILE_AUDIT_ALERT,
      changedResource: input.changedResource,
      ownClaims,
      conflictingClaims,
      relatedBlockingGateIds,
      shouldCreateGate: false,
    };
  }

  if (conflictingClaims.length > 0) {
    return {
      kind: FileAuditDecisionKind.FILE_POLLUTION_DETECTED,
      changedResource: input.changedResource,
      ownClaims,
      conflictingClaims,
      relatedBlockingGateIds,
      shouldCreateGate: true,
    };
  }

  return {
    kind: ownClaims.length > 0 ? FileAuditDecisionKind.CLAIMED_WRITE : FileAuditDecisionKind.FILE_CHANGED,
    changedResource: input.changedResource,
    ownClaims,
    conflictingClaims,
    relatedBlockingGateIds,
    shouldCreateGate: false,
  };
}

export function findMatchingClaims(claims: ResourceClaim[], resource: ResourceRef): ResourceClaim[] {
  return claims.filter(claim =>
    claim.resources.some(claimed => resourceLocatorsOverlap(claimed, resource)),
  );
}

export function gateMatchesResource(gate: FileAuditGateContext, resource: ResourceRef): boolean {
  if ((gate.relatedResources ?? []).some(related => resourceLocatorsOverlap(related, resource))) {
    return true;
  }

  return parseRelatedFileLocators(gate.relatedFiles ?? [])
    .some(locator => resourceLocatorsOverlap({ type: "file", scope: "file", locator, metadata: "" }, resource));
}

export function parseRelatedFileLocators(value: string[]): string[] {
  return value
    .flatMap(part => part.split("↔"))
    .map(part => part.trim())
    .filter(Boolean);
}
