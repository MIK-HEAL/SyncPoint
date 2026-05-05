/**
 * Code plugin validators — OperationValidators for file resources
 * and code_patch operations.
 *
 * Registered via registerCodePlugin() to hook into the generic
 * operation validation pipeline in syncpoint-core.
 */

import type { OperationValidator, OperationValidationContext, OperationCheckItem } from "syncpoint-core";
import { resourceRefsToFilePaths } from "./file-resource.js";
import { isValidPatchFormat, findUncoveredFiles, findConflictingClaims } from "./code-patch.js";
import type { FileClaim } from "syncpoint-core";

// ── Helper: resource claims → FileClaim-shaped objects ──

function claimsToFileClaims(claims: Array<{
  id: string;
  actorId: string;
  taskId: string;
  sessionId: string;
  resources: Array<{ type: string; locator: string; metadata: string }>;
  mode: string;
  status: string;
  createdAt: string;
  releasedAt: string;
}>): FileClaim[] {
  return claims
    .filter(c => c.resources.some(r => r.type === "file"))
    .map(c => ({
      id: c.id,
      agentId: c.actorId,
      taskId: c.taskId,
      sessionId: c.sessionId,
      paths: resourceRefsToFilePaths(c.resources),
      mode: c.mode as any,
      status: c.status as any,
      createdAt: c.createdAt,
      releasedAt: c.releasedAt,
    }));
}

// ── Validators ──────────────────────────────────────

/**
 * Validates that a code_patch payload is a valid unified diff format.
 */
export const codePatchFormatValidator: OperationValidator = {
  name: "code_patch_format",
  operationTypes: ["code_patch"],
  resourceTypes: ["file"],
  validate(ctx: OperationValidationContext): OperationCheckItem[] {
    const payload = ctx.payload ?? "";
    const valid = payload.length > 0 ? isValidPatchFormat(payload) : true;
    return [{
      check: "code_patch_format",
      passed: valid,
      detail: valid
        ? "Patch format is valid unified diff"
        : "Patch does not appear to be a valid unified diff",
    }];
  },
};

/**
 * Validates that all files touched by a code_patch are covered
 * by the actor's active file claims.
 */
export const codePatchClaimCoverageValidator: OperationValidator = {
  name: "code_patch_claim_coverage",
  operationTypes: ["code_patch"],
  resourceTypes: ["file"],
  validate(ctx: OperationValidationContext): OperationCheckItem[] {
    const touchedFiles = ctx.operation.targetResources
      .filter(r => r.type === "file")
      .map(r => r.locator);

    if (touchedFiles.length === 0) {
      return [{
        check: "code_patch_claim_coverage",
        passed: true,
        detail: "No file resources to check coverage for",
      }];
    }

    const fileClaims = claimsToFileClaims(ctx.actorClaims);
    const uncovered = findUncoveredFiles(touchedFiles, fileClaims);

    return [{
      check: "code_patch_claim_coverage",
      passed: uncovered.length === 0,
      detail: uncovered.length === 0
        ? "All touched files are covered by agent's active claims"
        : `Uncovered files: ${uncovered.join(", ")}`,
    }];
  },
};

/**
 * Validates that no other agent's exclusive file claims conflict
 * with the files touched by this code_patch.
 */
export const codePatchNoHardConflictValidator: OperationValidator = {
  name: "code_patch_no_hard_conflict",
  operationTypes: ["code_patch"],
  resourceTypes: ["file"],
  validate(ctx: OperationValidationContext): OperationCheckItem[] {
    const touchedFiles = ctx.operation.targetResources
      .filter(r => r.type === "file")
      .map(r => r.locator);

    if (touchedFiles.length === 0) {
      return [{
        check: "code_patch_no_hard_conflict",
        passed: true,
        detail: "No file resources to check conflicts for",
      }];
    }

    const allFileClaims = claimsToFileClaims(ctx.allActiveClaims);
    const conflicting = findConflictingClaims(
      touchedFiles,
      ctx.operation.actorId,
      allFileClaims,
    );

    return [{
      check: "code_patch_no_hard_conflict",
      passed: conflicting.length === 0,
      detail: conflicting.length === 0
        ? "No hard conflicts with other agents' exclusive claims"
        : `Conflicts with ${conflicting.length} claim(s): ${conflicting.map(c => c.id).join(", ")}`,
    }];
  },
};

/**
 * All code plugin validators.
 */
export const CODE_PLUGIN_VALIDATORS: OperationValidator[] = [
  codePatchFormatValidator,
  codePatchClaimCoverageValidator,
  codePatchNoHardConflictValidator,
];
