/**
 * ResourceClaim Service — generic resource ownership and conflict detection.
 *
 * Use cases:
 *   rcClaim         — declare resource ownership for a task
 *   rcRelease       — release a resource claim
 *   rcList          — list resource claims with filters
 *   rcDetectConflicts — detect overlapping resource claims
 */

import {
  detectResourceClaimConflicts,
  ResourceClaimStatus,
  SyncGateReason,
  EventType,
} from "syncpoint-core";
import type { ResourceClaim, ResourceClaimCreate, ResourceConflict, ResourceRef } from "syncpoint-core";
import * as protocolRepo from "../repositories/_exports/protocol.js";
import { logEvent } from "../repositories/_shared.js";
import { sgRequest, sgReconcileForClaims } from "./sync-gate-service.js";
import { resolveResourcePath } from "./path-resolver.js";

// ── Types ──────────────────────────────────────────────

export interface ClaimResourcesInput {
  actorId: string;
  taskId: string;
  sessionId?: string;
  resources: ResourceRef[];
  mode?: "exclusive" | "shared";
  autoGate?: boolean;
}

export interface ClaimResourcesResult {
  claim: ResourceClaim;
  conflicts: ResourceConflict[];
  gateId?: string;
}

export interface ListResourceClaimsInput {
  actorId?: string;
  taskId?: string;
  sessionId?: string;
  resourceType?: string;
  status?: string;
}

// ── Use Cases ──────────────────────────────────────────

/**
 * Claim resources for a task. Returns the claim and any conflicts detected.
 */
export function rcClaim(input: ClaimResourcesInput): ClaimResourcesResult {
  // Normalize resource locators before storing
  const normalizedResources: ResourceRef[] = input.resources.map(r => ({
    ...r,
    locator: r.type === "file" ? resolveResourcePath(r.locator) : r.locator,
  }));

  const create: ResourceClaimCreate = {
    actorId: input.actorId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    resources: normalizedResources,
    mode: input.mode as any,
  };

  const claim = protocolRepo.createResourceClaim(create);

  logEvent(
    EventType.RESOURCE_CLAIMED,
    "resource_claim",
    claim.id,
    JSON.stringify({
      actorId: input.actorId,
      taskId: input.taskId,
      resources: input.resources.map(r => `${r.type}:${r.locator}`),
    }),
  );

  // Detect conflicts involving this new claim
  const resourceType = input.resources[0]?.type;
  const allActive = protocolRepo.listActiveResourceClaims({
    sessionId: input.sessionId,
    resourceType,
  });
  const allConflicts = detectResourceClaimConflicts(allActive);
  const conflicts = allConflicts.filter(
    c => c.claimA.id === claim.id || c.claimB.id === claim.id,
  );

  if (conflicts.length > 0) {
    logEvent(
      EventType.RESOURCE_CONFLICT_DETECTED,
      "resource_claim",
      claim.id,
      JSON.stringify({
        conflictCount: conflicts.length,
        hardConflicts: conflicts.filter(c => c.isHardConflict).length,
      }),
    );
  }

  // Auto-create SyncGate for hard conflicts
  let gateId: string | undefined;
  const hardConflicts = conflicts.filter(c => c.isHardConflict);
  if (hardConflicts.length > 0 && (input.autoGate !== false)) {
    const otherActors = new Set<string>();
    const relatedClaimIds = new Set<string>();
    const overlappingLocators: string[] = [];
    for (const c of hardConflicts) {
      const other = c.claimA.id === claim.id ? c.claimB : c.claimA;
      otherActors.add(other.actorId);
      relatedClaimIds.add(c.claimA.id);
      relatedClaimIds.add(c.claimB.id);
      overlappingLocators.push(c.overlappingLocator);
    }
    const requiredAgentIds = [input.actorId, ...otherActors];
    const relatedResources = hardConflicts.flatMap(c => [
      ...c.claimA.resources,
      ...c.claimB.resources,
    ]);
    const gateResult = sgRequest({
      sessionId: input.sessionId,
      taskId: input.taskId,
      requestedByAgentId: input.actorId,
      requiredAgentIds,
      reason: SyncGateReason.RESOURCE_CONFLICT,
      description: `Resource conflict: ${overlappingLocators.join("; ")}`,
      relatedFiles: overlappingLocators,
      relatedResources,
      relatedClaimIds: [...relatedClaimIds],
    });
    gateId = gateResult.gate.id;
  }

  return { claim, conflicts, gateId };
}

/**
 * Release a resource claim.
 */
export function rcRelease(claimId: string): ResourceClaim {
  const claim = protocolRepo.releaseResourceClaim(claimId);

  logEvent(
    EventType.RESOURCE_RELEASED,
    "resource_claim",
    claim.id,
    JSON.stringify({ actorId: claim.actorId, taskId: claim.taskId }),
  );

  // Reconcile any resource conflict gates related to this claim.
  // If the conflict no longer exists, the gate may auto-resolve.
  sgReconcileForClaims([claimId]);

  return claim;
}

/**
 * List resource claims with optional filters.
 */
export function rcList(input?: ListResourceClaimsInput): ResourceClaim[] {
  return protocolRepo.listResourceClaims(input);
}

/**
 * Detect conflicts among active resource claims.
 */
export function rcDetectConflicts(opts?: {
  sessionId?: string;
  resourceType?: string;
}): ResourceConflict[] {
  const active = protocolRepo.listActiveResourceClaims(opts);
  return detectResourceClaimConflicts(active);
}
