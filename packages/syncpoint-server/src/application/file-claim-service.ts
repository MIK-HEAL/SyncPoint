/**
 * FileClaim Service — file ownership and conflict detection.
 *
 * Use cases:
 *   fcClaimFiles   — declare file ownership for a task
 *   fcReleaseClaim — release a file claim
 *   fcListClaims   — list file claims with filters
 *   fcDetectConflicts — detect overlapping file claims
 */

import { detectConflicts, FileClaimStatus } from "syncpoint-core";
import type { FileClaim, FileClaimCreate, FileConflict } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { EventType } from "syncpoint-core";

// ── Types ──────────────────────────────────────────────

export interface ClaimFilesInput {
  agentId: string;
  taskId: string;
  sessionId?: string;
  /** Comma-separated file paths or glob patterns */
  paths: string;
  mode?: "exclusive" | "shared";
}

export interface ClaimFilesResult {
  claim: FileClaim;
  conflicts: FileConflict[];
}

export interface ListClaimsInput {
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  status?: string;
}

// ── Use Cases ──────────────────────────────────────────

/**
 * Claim files for a task. Returns the claim and any conflicts detected.
 */
export function fcClaimFiles(input: ClaimFilesInput): ClaimFilesResult {
  repo.getAgent(input.agentId);
  repo.getTask(input.taskId);

  const create: FileClaimCreate = {
    agentId: input.agentId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    paths: input.paths,
    mode: input.mode as any,
  };

  const claim = repo.createFileClaim(create);

  logEvent(
    EventType.FILE_CLAIMED,
    "file_claim",
    claim.id,
    JSON.stringify({ agentId: input.agentId, taskId: input.taskId, paths: input.paths }),
  );

  // Detect conflicts involving this new claim only
  const allActive = repo.listActiveFileClaims(input.sessionId);
  const allConflicts = detectConflicts(allActive);
  const conflicts = allConflicts.filter(
    c => c.claimA.id === claim.id || c.claimB.id === claim.id,
  );

  if (conflicts.length > 0) {
    logEvent(
      EventType.FILE_CONFLICT_DETECTED,
      "file_claim",
      claim.id,
      JSON.stringify({
        conflictCount: conflicts.length,
        hardConflicts: conflicts.filter(c => c.isHardConflict).length,
      }),
    );
  }

  return { claim, conflicts };
}

/**
 * Release a file claim.
 */
export function fcReleaseClaim(claimId: string): FileClaim {
  const claim = repo.releaseFileClaim(claimId);

  logEvent(
    EventType.FILE_RELEASED,
    "file_claim",
    claim.id,
    JSON.stringify({ agentId: claim.agentId, taskId: claim.taskId }),
  );

  return claim;
}

/**
 * List file claims with optional filters.
 */
export function fcListClaims(input?: ListClaimsInput): FileClaim[] {
  return repo.listFileClaims(input);
}

/**
 * Detect conflicts among active file claims.
 */
export function fcDetectConflicts(sessionId?: string): FileConflict[] {
  const active = repo.listActiveFileClaims(sessionId);
  return detectConflicts(active);
}
