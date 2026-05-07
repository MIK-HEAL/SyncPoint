/**
 * syncpoint-plugin-generic-agent — plugin for generic (non-code) resource
 * ownership, multi-modal operation validation, and constraint enforcement.
 *
 * Call registerGenericAgentPlugin() once at startup to activate:
 *   - ResourceMatchers for artifact, binary_asset, document, design_asset, dataset_slice
 *   - OperationValidators for artifact_update, artifact_review, artifact_transform, asset_generate, asset_edit
 *   - ConstraintRuleEvaluator for resource_forbidden
 *   - ScopeMatchers for "resources" and "assetTypes" appliesTo fields
 *
 * @example
 *   import { registerGenericAgentPlugin } from "syncpoint-plugin-generic-agent";
 *   registerGenericAgentPlugin();
 */

import {
  registerResourceMatcher,
  getResourceMatcher,
  registerOperationValidator,
  getValidatorsForOperation,
  registerConstraintRuleEvaluator,
  getConstraintRuleEvaluator,
  registerScopeMatcher,
  getScopeMatcher,
} from "syncpoint-core";
import { GENERIC_RESOURCE_MATCHERS } from "./matchers.js";
import { GENERIC_VALIDATORS } from "./validators.js";
import { resourceForbiddenEvaluator } from "./constraint-evaluators.js";
import { resourcesScopeMatcher, assetTypesScopeMatcher } from "./scope-matchers.js";
import { GENERIC_RESOURCE_TYPES } from "./resource-types.js";

// ── Plugin registration ──────────────────────────────

let _registered = false;

/**
 * Register the generic agent plugin with the core registries.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function registerGenericAgentPlugin(): void {
  // 1. Resource matchers (one per generic resource type)
  for (const m of GENERIC_RESOURCE_MATCHERS) {
    if (!getResourceMatcher(m.type)) {
      registerResourceMatcher(m);
    }
  }

  // 2. Operation validators (idempotent via name check)
  const registeredNames = new Set(
    getValidatorsForOperation("artifact_update", ["artifact"]).map(v => v.name),
  );
  for (const v of GENERIC_VALIDATORS) {
    if (!registeredNames.has(v.name)) {
      registerOperationValidator(v);
      registeredNames.add(v.name);
    }
  }

  // 3. Constraint rule evaluator: resource_forbidden
  if (!getConstraintRuleEvaluator("resource_forbidden")) {
    registerConstraintRuleEvaluator(resourceForbiddenEvaluator);
  }

  // 4. Scope matchers for projection appliesTo filtering
  // resources matcher only checks generic resource types (not "file")
  if (!getScopeMatcher("resources")) {
    registerScopeMatcher({
      field: "resources",
      findOverlaps: resourcesScopeMatcher,
      resourceTypes: [...GENERIC_RESOURCE_TYPES],
    });
  }
  // assetTypes has no resourceTypes filter — it matches a context dimension, not locators
  if (!getScopeMatcher("assetTypes")) {
    registerScopeMatcher({ field: "assetTypes", findOverlaps: assetTypesScopeMatcher });
  }

  _registered = true;
}

/**
 * Check if the generic agent plugin has been registered.
 */
export function isGenericAgentPluginRegistered(): boolean {
  return _registered;
}

/**
 * Reset registration state (for testing only).
 */
export function _resetGenericAgentPlugin(): void {
  _registered = false;
}

// ── Re-exports ───────────────────────────────────────

// Locator utilities
export {
  parseLocator,
  locatorPath,
  locatorScheme,
  locatorPathsOverlap,
} from "./locator.js";

export type { ParsedLocator } from "./locator.js";

// Type constants
export { GENERIC_RESOURCE_TYPES } from "./resource-types.js";
export type { GenericResourceType } from "./resource-types.js";

export { GENERIC_OPERATION_TYPES } from "./operation-types.js";
export type { GenericOperationType } from "./operation-types.js";

// Matchers
export { GENERIC_RESOURCE_MATCHERS } from "./matchers.js";

// Validators
export {
  GENERIC_VALIDATORS,
  genericClaimCoverageValidator,
  genericNoHardConflictValidator,
  genericPayloadPresentValidator,
} from "./validators.js";

// Constraint evaluators
export { resourceForbiddenEvaluator } from "./constraint-evaluators.js";

// Scope matchers
export { resourcesScopeMatcher, assetTypesScopeMatcher } from "./scope-matchers.js";
