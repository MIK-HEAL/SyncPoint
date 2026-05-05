/**
 * Resource — generic resource reference and claim protocol.
 *
 * Provides pluggable locator overlap detection via ResourceMatcher.
 * Plugins register matchers for specific resource types (e.g. "file");
 * unknown types fall back to exact locator equality.
 */

import { z } from "zod";

// ── ResourceRef ────────────────────────────────────

/**
 * A reference to any addressable resource in the project.
 */
export const ResourceRefSchema = z.object({
  type: z.string().min(1),
  id: z.string().optional(),
  locator: z.string().min(1),
  metadata: z.string().default(""),
});

export type ResourceRef = z.infer<typeof ResourceRefSchema>;

// ── Claim Status / Mode ────────────────────────────

export enum ResourceClaimStatus {
  ACTIVE = "ACTIVE",
  RELEASED = "RELEASED",
}

export enum ResourceClaimMode {
  EXCLUSIVE = "exclusive",
  SHARED = "shared",
}

// ── ResourceClaim ──────────────────────────────────

export const ResourceClaimSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().default(""),
  resources: z.array(ResourceRefSchema),
  mode: z.nativeEnum(ResourceClaimMode),
  status: z.nativeEnum(ResourceClaimStatus),
  createdAt: z.string(),
  releasedAt: z.string(),
});

export type ResourceClaim = z.infer<typeof ResourceClaimSchema>;

export const ResourceClaimCreateSchema = z.object({
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  resources: z.array(ResourceRefSchema).min(1),
  mode: z.nativeEnum(ResourceClaimMode).default(ResourceClaimMode.EXCLUSIVE),
});

export type ResourceClaimCreate = z.infer<typeof ResourceClaimCreateSchema>;

// ── ResourceConflict ───────────────────────────────

export interface ResourceConflict {
  /** The resource locators that overlap */
  overlappingLocator: string;
  resourceType: string;
  claimA: ResourceClaim;
  claimB: ResourceClaim;
  /** True when at least one side is EXCLUSIVE */
  isHardConflict: boolean;
}

// ── ResourceMatcher ───────────────────────────────

/**
 * A ResourceMatcher knows how to determine overlap between two
 * locators of the same resource type.  Plugins register matchers
 * so that core conflict detection can delegate to type-specific logic.
 */
export interface ResourceMatcher {
  /** The resource type this matcher handles, e.g. "file". */
  type: string;
  /** Return true if locators a and b overlap for this resource type. */
  locatorsOverlap(a: string, b: string): boolean;
}

const _matchers = new Map<string, ResourceMatcher>();

/**
 * Register a ResourceMatcher for a given resource type.
 * Overwrites any previously registered matcher for the same type.
 */
export function registerResourceMatcher(m: ResourceMatcher): void {
  _matchers.set(m.type, m);
}

/**
 * Get the registered matcher for a resource type, or undefined.
 */
export function getResourceMatcher(type: string): ResourceMatcher | undefined {
  return _matchers.get(type);
}

/**
 * Clear all registered matchers (for testing).
 */
export function clearResourceMatcherRegistry(): void {
  _matchers.clear();
}

// ── Pure functions ─────────────────────────────────

/**
 * Check if two resource locators overlap.
 * Delegates to a registered ResourceMatcher for the type;
 * falls back to exact locator equality if no matcher is registered.
 */
export function resourceLocatorsOverlap(
  a: ResourceRef,
  b: ResourceRef,
): boolean {
  // Different resource types never overlap
  if (a.type !== b.type) return false;

  const matcher = _matchers.get(a.type);
  if (matcher) {
    return matcher.locatorsOverlap(a.locator, b.locator);
  }

  // Default: exact match on locator
  return a.locator === b.locator;
}

/**
 * Detect conflicts between a set of active resource claims.
 * Returns all pairs of claims that have overlapping resources.
 */
export function detectResourceClaimConflicts(claims: ResourceClaim[]): ResourceConflict[] {
  const active = claims.filter(c => c.status === ResourceClaimStatus.ACTIVE);
  const conflicts: ResourceConflict[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      // Same actor on same task — not a conflict
      if (a.actorId === b.actorId && a.taskId === b.taskId) continue;

      for (const ra of a.resources) {
        for (const rb of b.resources) {
          if (resourceLocatorsOverlap(ra, rb)) {
            conflicts.push({
              overlappingLocator: `${ra.locator} ↔ ${rb.locator}`,
              resourceType: ra.type,
              claimA: a,
              claimB: b,
              isHardConflict:
                a.mode === ResourceClaimMode.EXCLUSIVE ||
                b.mode === ResourceClaimMode.EXCLUSIVE,
            });
          }
        }
      }
    }
  }

  return conflicts;
}
