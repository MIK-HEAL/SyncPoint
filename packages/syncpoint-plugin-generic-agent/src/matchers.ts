/**
 * ResourceMatcher implementations for generic resource types.
 *
 * All generic types use URI-path-prefix overlap by default.
 * Type-specific spatial/temporal overlap (bbox, frame ranges)
 * is deferred to domain plugins (image, video).
 */

import type { ResourceMatcher } from "syncpoint-core";
import { locatorPathsOverlap } from "./locator.js";
import { GENERIC_RESOURCE_TYPES } from "./resource-types.js";

/**
 * Build a ResourceMatcher for a generic resource type.
 * All use the same path-prefix overlap logic.
 */
function makeMatcher(type: string): ResourceMatcher {
  return {
    type,
    locatorsOverlap: locatorPathsOverlap,
  };
}

/**
 * All ResourceMatchers for generic resource types.
 */
export const GENERIC_RESOURCE_MATCHERS: ResourceMatcher[] =
  GENERIC_RESOURCE_TYPES.map(t => makeMatcher(t));
