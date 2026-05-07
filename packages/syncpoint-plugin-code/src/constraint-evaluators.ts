/**
 * Code plugin constraint evaluators — ConstraintRuleEvaluator implementations
 * for file_forbidden and module_forbidden rule types.
 *
 * These evaluators were previously inline test-only dummies in
 * syncpoint-core/constraint-runtime.test.ts. Now they live here as
 * real production evaluators registered by registerCodePlugin().
 */

import type {
  ConstraintRuleEvaluator,
  ConstraintViolation,
  ConstraintInput,
  ProjectionItem,
  ConstraintRuntimeSpec,
} from "syncpoint-core";
import { pathsOverlap } from "./file-resource.js";

// ── Prefix overlap helper ────────────────────────────

/**
 * Find targets that overlap with any pattern via prefix matching.
 * Handles exact match, prefix directories, and simple globs.
 */
export function prefixFindOverlaps(patterns: string[], targets: string[]): string[] {
  return targets.filter(t =>
    patterns.some(p => pathsOverlap(p, t)),
  );
}

// ── file_forbidden ───────────────────────────────────

/**
 * Evaluator for `file_forbidden` constraint rule type.
 * Blocks operations when touched resources overlap with forbidden file paths
 * declared in the constraint's scope.files field.
 */
export const fileForbiddenEvaluator: ConstraintRuleEvaluator = {
  ruleType: "file_forbidden",
  evaluate(
    input: ConstraintInput,
    item: ProjectionItem,
    spec: ConstraintRuntimeSpec,
  ): ConstraintViolation | null {
    const locators = (input.touchedResources ?? [])
      .filter(r => r.type === "file")
      .map(r => r.locator);
    if (!locators.length) return null;
    const overlaps = prefixFindOverlaps(item.scope?.files ?? [], locators);
    if (overlaps.length === 0) return null;
    return {
      rule: "hard_constraint_file_forbidden",
      sourceMemoryId: item.source.sourceMemoryId,
      projectionId: input.projection.projectionId,
      message: spec.message ?? `Constraint "${item.title}" forbids resources: ${overlaps.join(", ")}`,
      evidence: overlaps,
    };
  },
};

// ── module_forbidden ─────────────────────────────────

/**
 * Evaluator for `module_forbidden` constraint rule type.
 * Blocks operations when touched resources fall under a forbidden module
 * declared in the constraint's scope.modules field.
 */
export const moduleForbiddenEvaluator: ConstraintRuleEvaluator = {
  ruleType: "module_forbidden",
  evaluate(
    input: ConstraintInput,
    item: ProjectionItem,
    spec: ConstraintRuntimeSpec,
  ): ConstraintViolation | null {
    const locators = (input.touchedResources ?? [])
      .filter(r => r.type === "file")
      .map(r => r.locator);
    if (!locators.length) return null;
    const modulePatterns = item.scope?.modules ?? [];
    if (modulePatterns.length === 0) return null;
    const matches = locators.filter(loc =>
      modulePatterns.some(mod => loc.startsWith(mod + "/") || loc === mod),
    );
    if (matches.length === 0) return null;
    return {
      rule: "hard_constraint_module_forbidden",
      sourceMemoryId: item.source.sourceMemoryId,
      projectionId: input.projection.projectionId,
      message: spec.message ?? `Constraint "${item.title}" forbids modules: ${matches.join(", ")}`,
      evidence: matches,
    };
  },
};

/**
 * All code plugin constraint evaluators.
 */
export const CODE_PLUGIN_CONSTRAINT_EVALUATORS: ConstraintRuleEvaluator[] = [
  fileForbiddenEvaluator,
  moduleForbiddenEvaluator,
];
