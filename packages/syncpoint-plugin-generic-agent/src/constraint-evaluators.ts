/**
 * ConstraintRuleEvaluator for generic resource types.
 *
 * Provides "resource_forbidden" — blocks operations touching resources
 * that match a hard_constraint scope.
 */

import type { ConstraintRuleEvaluator, ConstraintViolation, ConstraintInput } from "syncpoint-core";
import type { ProjectionItem, ConstraintRuntimeSpec } from "syncpoint-core";
import { locatorPathsOverlap } from "./locator.js";

/**
 * resource_forbidden — evaluates hard_constraints with scope.resources
 * against touched resources. Blocks when any touched resource locator
 * overlaps with the forbidden resource patterns.
 *
 * Scope format expected:
 *   { "resources": ["artifact://landing-page", "binary://brand-logo.png"] }
 */
export const resourceForbiddenEvaluator: ConstraintRuleEvaluator = {
  ruleType: "resource_forbidden",
  evaluate(
    input: ConstraintInput,
    item: ProjectionItem,
    spec: ConstraintRuntimeSpec,
  ): ConstraintViolation | null {
    const locators = (input.touchedResources ?? []).map(r => r.locator);
    if (!locators.length) return null;

    const forbidden: string[] = (item.scope as Record<string, string[] | undefined>)?.resources ?? [];
    if (!forbidden.length) return null;

    const overlaps = locators.filter(loc =>
      forbidden.some(pat => locatorPathsOverlap(loc, pat)),
    );

    if (overlaps.length === 0) return null;

    return {
      rule: "resource_forbidden",
      sourceMemoryId: item.source.sourceMemoryId,
      projectionId: input.projection.projectionId,
      message: spec.message ?? `Touches forbidden resources: ${overlaps.join(", ")}`,
      evidence: overlaps,
    };
  },
};
