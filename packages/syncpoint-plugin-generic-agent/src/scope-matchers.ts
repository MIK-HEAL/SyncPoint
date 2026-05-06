/**
 * ScopeMatcher implementations for generic resource types.
 *
 * Registered by the plugin to enable appliesTo filtering and
 * constraint scope matching for non-file, non-module fields.
 */

import { locatorPathsOverlap } from "./locator.js";

/**
 * Scope matcher for "resources" field in appliesTo.
 *
 * Patterns are URI-style locators; targets are working resource locators.
 * Uses path-prefix overlap matching.
 */
export function resourcesScopeMatcher(patterns: string[], targets: string[]): string[] {
  return targets.filter(t =>
    patterns.some(p => locatorPathsOverlap(t, p)),
  );
}

/**
 * Scope matcher for "assetTypes" field in appliesTo.
 *
 * Simple exact string match — "image" matches "image", etc.
 */
export function assetTypesScopeMatcher(patterns: string[], targets: string[]): string[] {
  const pSet = new Set(patterns);
  return targets.filter(t => pSet.has(t));
}
