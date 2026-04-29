/**
 * FileClaim Service — file ownership and conflict detection.
 *
 * Use cases:
 *   fcClaimFiles   — declare file ownership for a task
 *   fcReleaseClaim — release a file claim
 *   fcListClaims   — list file claims with filters
 *   fcDetectConflicts — detect overlapping file claims
 */

import { detectConflicts, FileClaimStatus, SyncGateReason } from "syncpoint-core";
import type { FileClaim, FileClaimCreate, FileConflict } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { EventType } from "syncpoint-core";
import { sgRequest } from "./sync-gate-service.js";

// ── Types ──────────────────────────────────────────────

export interface ClaimFilesInput {
  agentId: string;
  taskId: string;
  sessionId?: string;
  /** Comma-separated file paths or glob patterns */
  paths: string;
  mode?: "exclusive" | "shared";
  /** If true, auto-create SyncGate on hard conflict (default: true) */
  autoGate?: boolean;
}

export interface ClaimFilesResult {
  claim: FileClaim;
  conflicts: FileConflict[];
  /** Gate ID if a SyncGate was auto-created for a hard conflict */
  gateId?: string;
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

  // Auto-create SyncGate for hard conflicts
  let gateId: string | undefined;
  const hardConflicts = conflicts.filter(c => c.isHardConflict);
  if (hardConflicts.length > 0 && (input.autoGate !== false)) {
    // Collect unique agent IDs from the other side of each hard conflict
    const otherAgents = new Set<string>();
    const relatedClaimIds = new Set<string>();
    const overlappingFiles: string[] = [];
    for (const c of hardConflicts) {
      const other = c.claimA.id === claim.id ? c.claimB : c.claimA;
      otherAgents.add(other.agentId);
      relatedClaimIds.add(c.claimA.id);
      relatedClaimIds.add(c.claimB.id);
      overlappingFiles.push(c.overlappingPath);
    }
    // Both the claiming agent and conflicting agents must sync
    const requiredAgentIds = [input.agentId, ...otherAgents];
    const gateResult = sgRequest({
      sessionId: input.sessionId,
      taskId: input.taskId,
      requestedByAgentId: input.agentId,
      requiredAgentIds,
      reason: SyncGateReason.FILE_CONFLICT,
      description: `File ownership conflict: ${overlappingFiles.join("; ")}`,
      relatedFiles: overlappingFiles.join(","),
      relatedClaimIds: [...relatedClaimIds].join(","),
    });
    gateId = gateResult.gate.id;
  }

  return { claim, conflicts, gateId };
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
