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
  ResourceScope,
  SyncGateReason,
  EventType,
  computeLineDrift,
} from "syncpoint-core";
import type { ResourceClaim, ResourceClaimCreate, ResourceConflict, ResourceRef } from "syncpoint-core";
import * as protocolRepo from "../repositories/_exports/protocol.js";
import { logEvent } from "../repositories/_shared.js";
import { sgRequest, sgReconcileForClaims } from "./sync-gate-service.js";
import { resolveResourcePath } from "./path-resolver.js";
import fs from "node:fs";
import path from "node:path";

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

// ── Line-range drift tracking ─────────────────────────

export interface LineRangeDriftUpdateResult {
  /** Number of claims updated. */
  updatedClaims: number;
  /** Number of line-range resources updated. */
  updatedRanges: number;
  /** Number of ranges that were fully deleted (claim resources dropped). */
  deletedRanges: number;
  /** Claim IDs that were updated. */
  claimIds: string[];
}

/**
 * Update line_range scopes on active resource claims after a file edit.
 *
 * Computes the line-number drift between old and new source content,
 * then remaps all line_range–scoped resources for the given file locator.
 *
 * @param locator - Normalized file locator (relative path).
 * @param oldSource - File content before the edit.
 * @param newSource - File content after the edit.
 * @returns Summary of updates performed.
 */
export function rcUpdateLineRangesForFile(
  locator: string,
  oldSource: string,
  newSource: string,
): LineRangeDriftUpdateResult {
  const claims = protocolRepo.findActiveLineRangeClaimsForLocator(locator);

  if (claims.length === 0) {
    return { updatedClaims: 0, updatedRanges: 0, deletedRanges: 0, claimIds: [] };
  }

  const { mapping } = computeLineDrift(oldSource, newSource);
  let updatedRanges = 0;
  let deletedRanges = 0;
  const updatedClaimIds: string[] = [];

  for (const claim of claims) {
    let claimUpdated = false;
    for (const resource of claim.resources) {
      if (resource.type !== "file" || resource.locator !== locator) continue;
      if (resource.scope !== ("line_range" as ResourceScope) || !resource.lineRange) continue;

      const remapped = mapping.remapRange(resource.lineRange);
      if (!remapped) {
        // Range was fully deleted — release this resource from the claim
        deletedRanges++;
        claimUpdated = true;
        logEvent(
          EventType.RESOURCE_RELEASED,
          "resource_claim",
          claim.id,
          JSON.stringify({
            reason: "line_range_deleted",
            locator,
            oldRange: resource.lineRange,
          }),
        );
        // Note: fully deleting a resource from a claim is complex (need to handle
        // the case where it's the last resource). For now, we keep the range but
        // log the event. The claim can be manually released if all ranges are gone.
        continue;
      }

      if (
        remapped.start !== resource.lineRange.start ||
        remapped.end !== resource.lineRange.end
      ) {
        protocolRepo.updateResourceLineRange(
          claim.id,
          locator,
          remapped.start,
          remapped.end,
        );
        updatedRanges++;
        claimUpdated = true;
        logEvent(
          EventType.RESOURCE_CLAIMED,
          "resource_claim",
          claim.id,
          JSON.stringify({
            reason: "line_range_drift",
            locator,
            oldRange: resource.lineRange,
            newRange: remapped,
          }),
        );
      }
    }
    if (claimUpdated) {
      updatedClaimIds.push(claim.id);
    }
  }

  return {
    updatedClaims: updatedClaimIds.length,
    updatedRanges,
    deletedRanges,
    claimIds: updatedClaimIds,
  };
}

/**
 * Look up whether a file has any active line_range claims that would need
 * drift tracking. Callers can use this to decide whether to cache old source
 * before an edit.
 */
export function rcHasLineRangeClaims(locator: string): boolean {
  const claims = protocolRepo.findActiveLineRangeClaimsForLocator(locator);
  return claims.length > 0;
}
