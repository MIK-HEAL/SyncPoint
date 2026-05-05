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

import { getValidatorsForOperation, registerOperationValidator, registerResourceMatcher, getResourceMatcher } from "syncpoint-core";
import { CODE_PLUGIN_VALIDATORS } from "./validators.js";
import { pathsOverlap } from "./file-resource.js";

// ── Plugin registration ─────────────────────────────

let _registered = false;

/**
 * Register the code plugin's validators and resource matcher with the core registries.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function registerCodePlugin(): void {
  // Register file ResourceMatcher (prefix/directory/glob overlap)
  if (!getResourceMatcher("file")) {
    registerResourceMatcher({
      type: "file",
      locatorsOverlap: pathsOverlap,
    });
  }

  // Register OperationValidators for code_patch + file
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

