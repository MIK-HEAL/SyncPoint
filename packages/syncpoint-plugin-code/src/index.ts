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

import {
  getValidatorsForOperation,
  registerOperationValidator,
  registerResourceMatcher,
  getResourceMatcher,
  registerConstraintEvaluator,
  getConstraintEvaluator,
  registerScopeMatcher,
  getScopeMatcher,
} from "syncpoint-core";
import { CODE_PLUGIN_VALIDATORS } from "./validators.js";
import { pathsOverlap } from "./file-resource.js";
import { CODE_PLUGIN_CONSTRAINT_EVALUATORS, prefixFindOverlaps } from "./constraint-evaluators.js";

// ── Plugin registration ─────────────────────────────

/**
 * Register the code plugin's validators and resource matcher with the core registries.
 * Safe to call multiple times — subsequent calls are no-ops (each registry check prevents duplicates).
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

  // Register ConstraintRuleEvaluators (file_forbidden, module_forbidden)
  for (const e of CODE_PLUGIN_CONSTRAINT_EVALUATORS) {
    if (!getConstraintEvaluator(e.ruleType)) {
      registerConstraintEvaluator(e);
    }
  }

  // Register ScopeMatchers for files and modules
  if (!getScopeMatcher("files")) {
    registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });
  }
  if (!getScopeMatcher("modules")) {
    registerScopeMatcher({ field: "modules", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });
  }
}

/**
 * Check if the code plugin has been registered.
 * Uses the resource matcher registry as source of truth.
 */
export function isCodePluginRegistered(): boolean {
  return getResourceMatcher("file") !== undefined;
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

// Constraint evaluators
export {
  fileForbiddenEvaluator,
  moduleForbiddenEvaluator,
  CODE_PLUGIN_CONSTRAINT_EVALUATORS,
  prefixFindOverlaps,
} from "./constraint-evaluators.js";

// ── Function parser (moved from kernel — optional code analysis) ──
export {
  parseFunctions,
  findFunctionAtLine,
  registerFunctionParseStrategy,
  getFunctionParseStrategy,
  getStrategyForExtension,
  clearFunctionParseStrategies,
} from "./function-parser.js";
export type {
  ParsedFunction,
  FunctionParseStrategy,
} from "./function-parser.js";

