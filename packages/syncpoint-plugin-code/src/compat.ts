/**
 * Compat — conversion helpers between legacy FileClaim/PatchProposal
 * and generic ResourceClaim/Operation types.
 *
 * These functions canonically live here in the code plugin.
 * Core re-exports them for backward compatibility.
 */

import type {
  FileClaim,
  ResourceClaim,
  ResourceConflict,
  FileConflict,
  PatchProposal,
  Operation,
} from "syncpoint-core";
import {
  FileClaimStatus,
  FileClaimMode,
  ResourceClaimStatus,
  ResourceClaimMode,
  PatchProposalStatus,
  OperationStatus,
} from "syncpoint-core";
import { filePathsToResourceRefs } from "./file-resource.js";

// ── FileClaim ↔ ResourceClaim ───────────────────────

/**
 * Convert a FileClaim to a generic ResourceClaim.
 */
export function fileClaimToResourceClaim(fc: FileClaim): ResourceClaim {
  return {
    id: fc.id,
    actorId: fc.agentId,
    taskId: fc.taskId,
    sessionId: fc.sessionId,
    resources: filePathsToResourceRefs(fc.paths),
    mode: fc.mode === FileClaimMode.EXCLUSIVE
      ? ResourceClaimMode.EXCLUSIVE
      : ResourceClaimMode.SHARED,
    status: fc.status === FileClaimStatus.ACTIVE
      ? ResourceClaimStatus.ACTIVE
      : ResourceClaimStatus.RELEASED,
    createdAt: fc.createdAt,
    releasedAt: fc.releasedAt,
  };
}

/**
 * Convert a generic ResourceConflict back to a FileConflict.
 */
export function resourceConflictToFileConflict(
  rc: ResourceConflict,
  claimLookup: Map<string, FileClaim>,
): FileConflict {
  return {
    overlappingPath: rc.overlappingLocator,
    claimA: claimLookup.get(rc.claimA.id)!,
    claimB: claimLookup.get(rc.claimB.id)!,
    isHardConflict: rc.isHardConflict,
  };
}

// ── PatchProposal ↔ Operation ───────────────────────

const PATCH_STATUS_TO_OP: Record<string, OperationStatus> = {
  [PatchProposalStatus.DRAFT]: OperationStatus.DRAFT,
  [PatchProposalStatus.SUBMITTED]: OperationStatus.SUBMITTED,
  [PatchProposalStatus.CONFLICTING]: OperationStatus.CONFLICTING,
  [PatchProposalStatus.APPROVED]: OperationStatus.APPROVED,
  [PatchProposalStatus.REJECTED]: OperationStatus.REJECTED,
  [PatchProposalStatus.APPLIED]: OperationStatus.APPLIED,
  [PatchProposalStatus.CANCELLED]: OperationStatus.CANCELLED,
};

const OP_STATUS_TO_PATCH: Record<string, PatchProposalStatus> = {
  [OperationStatus.DRAFT]: PatchProposalStatus.DRAFT,
  [OperationStatus.SUBMITTED]: PatchProposalStatus.SUBMITTED,
  [OperationStatus.CONFLICTING]: PatchProposalStatus.CONFLICTING,
  [OperationStatus.APPROVED]: PatchProposalStatus.APPROVED,
  [OperationStatus.REJECTED]: PatchProposalStatus.REJECTED,
  [OperationStatus.APPLIED]: PatchProposalStatus.APPLIED,
  [OperationStatus.CANCELLED]: PatchProposalStatus.CANCELLED,
};

/**
 * Convert a PatchProposal to a generic Operation(type="code_patch").
 */
export function patchProposalToOperation(pp: PatchProposal): Operation {
  return {
    id: pp.id,
    type: "code_patch",
    actorId: pp.agentId,
    taskId: pp.taskId,
    sessionId: pp.sessionId,
    title: pp.title,
    summary: pp.summary,
    targetResources: filePathsToResourceRefs(pp.touchedFiles),
    payloadRef: "",
    status: PATCH_STATUS_TO_OP[pp.status] ?? OperationStatus.DRAFT,
    checkResult: pp.checkResult,
    decisionSummary: pp.decisionSummary,
    createdAt: pp.createdAt,
    updatedAt: pp.updatedAt,
  };
}

/**
 * Convert a generic Operation back to PatchProposal shape.
 * Only valid for operations with type="code_patch".
 */
export function operationToPatchProposal(
  op: Operation,
  patchText: string,
  relatedClaimIds: string,
): PatchProposal {
  return {
    id: op.id,
    sessionId: op.sessionId,
    taskId: op.taskId,
    agentId: op.actorId,
    title: op.title,
    summary: op.summary,
    patchText,
    touchedFiles: op.targetResources
      .filter(r => r.type === "file")
      .map(r => r.locator)
      .join(","),
    relatedClaimIds,
    status: OP_STATUS_TO_PATCH[op.status] ?? PatchProposalStatus.DRAFT,
    checkResult: op.checkResult,
    decisionSummary: op.decisionSummary,
    createdAt: op.createdAt,
    updatedAt: op.updatedAt,
  };
}

/**
 * Map PatchProposalStatus to OperationStatus.
 */
export function patchStatusToOperationStatus(s: PatchProposalStatus): OperationStatus {
  return PATCH_STATUS_TO_OP[s] ?? OperationStatus.DRAFT;
}

/**
 * Map OperationStatus to PatchProposalStatus.
 */
export function operationStatusToPatchStatus(s: OperationStatus): PatchProposalStatus {
  return OP_STATUS_TO_PATCH[s] ?? PatchProposalStatus.DRAFT;
}
