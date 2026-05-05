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
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { sgRequest } from "./sync-gate-service.js";

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
  const create: ResourceClaimCreate = {
    actorId: input.actorId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    resources: input.resources,
    mode: input.mode as any,
  };

  const claim = repo.createResourceClaim(create);

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
  const allActive = repo.listActiveResourceClaims({
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
    const resourcesJson = JSON.stringify(
      hardConflicts.flatMap(c => [
        ...c.claimA.resources,
        ...c.claimB.resources,
      ]),
    );
    const gateResult = sgRequest({
      sessionId: input.sessionId,
      taskId: input.taskId,
      requestedByAgentId: input.actorId,
      requiredAgentIds,
      reason: SyncGateReason.RESOURCE_CONFLICT,
      description: `Resource conflict: ${overlappingLocators.join("; ")}`,
      relatedFiles: overlappingLocators.join(","),
      relatedResourcesJson: resourcesJson,
      relatedClaimIds: [...relatedClaimIds].join(","),
    });
    gateId = gateResult.gate.id;
  }

  return { claim, conflicts, gateId };
}

/**
 * Release a resource claim.
 */
export function rcRelease(claimId: string): ResourceClaim {
  const claim = repo.releaseResourceClaim(claimId);

  logEvent(
    EventType.RESOURCE_RELEASED,
    "resource_claim",
    claim.id,
    JSON.stringify({ actorId: claim.actorId, taskId: claim.taskId }),
  );

  return claim;
}

/**
 * List resource claims with optional filters.
 */
export function rcList(input?: ListResourceClaimsInput): ResourceClaim[] {
  return repo.listResourceClaims(input);
}

/**
 * Detect conflicts among active resource claims.
 */
export function rcDetectConflicts(opts?: {
  sessionId?: string;
  resourceType?: string;
}): ResourceConflict[] {
  const active = repo.listActiveResourceClaims(opts);
  return detectResourceClaimConflicts(active);
}
