/**
 * syncpoint-plugin-code — first-party plugin for file resource ownership
 * and code patch operations.
 *
 * Call registerCodePlugin() once at startup to activate validators.
 *
 * @example
 *   import { registerCodePlugin } from "syncpoint-plugin-code";
 *   registerCodePlugin();
 */

import { getValidatorsForOperation, registerOperationValidator } from "syncpoint-core";
import { CODE_PLUGIN_VALIDATORS } from "./validators.js";

// ── Plugin registration ─────────────────────────────

let _registered = false;

/**
 * Register the code plugin's validators with the core validator registry.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function registerCodePlugin(): void {
  const registeredNames = new Set(
    getValidatorsForOperation("code_patch", ["file"]).map(v => v.name),
  );
  for (const v of CODE_PLUGIN_VALIDATORS) {
    if (!registeredNames.has(v.name)) {
      registerOperationValidator(v);
      registeredNames.add(v.name);
    }
  }
  _registered = true;
}

/**
 * Check if the code plugin has been registered.
 */
export function isCodePluginRegistered(): boolean {
  return _registered;
}

/**
 * Reset registration state (for testing only).
 */
export function _resetCodePlugin(): void {
  _registered = false;
}

// ── Re-exports ──────────────────────────────────────

// File resource helpers
export {
  parseClaimPaths,
  pathsOverlap,
  filePathsToResourceRefs,
  resourceRefsToFilePaths,
} from "./file-resource.js";

// Code patch helpers
export {
  extractTouchedFiles,
  isValidPatchFormat,
  findUncoveredFiles,
  findConflictingClaims,
  runCodePatchChecks,
} from "./code-patch.js";
export type {
  CodePatchCheckItem,
  CodePatchCheckResult,
} from "./code-patch.js";

// Validators
export {
  codePatchFormatValidator,
  codePatchClaimCoverageValidator,
  codePatchNoHardConflictValidator,
  CODE_PLUGIN_VALIDATORS,
} from "./validators.js";

// Compat (FileClaim ↔ ResourceClaim, PatchProposal ↔ Operation)
export {
  fileClaimToResourceClaim,
  resourceConflictToFileConflict,
  patchProposalToOperation,
  operationToPatchProposal,
  patchStatusToOperationStatus,
  operationStatusToPatchStatus,
} from "./compat.js";
