/**
 * Resource — generic resource reference and claim protocol.
 *
 * Generalizes the concept of "file ownership" to any resource type.
 * FileClaim is the first specialization (type="file"), but the protocol
 * supports image, video, binary, or any future resource type.
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

// ── Pure functions ─────────────────────────────────

/**
 * Check if two resource locators overlap.
 * For type="file", applies path/glob overlap semantics.
 * For other types, uses exact match on locator.
 */
export function resourceLocatorsOverlap(
  a: ResourceRef,
  b: ResourceRef,
): boolean {
  // Different resource types never overlap
  if (a.type !== b.type) return false;

  if (a.type === "file") {
    return fileLocatorsOverlap(a.locator, b.locator);
  }

  // Default: exact match on locator
  return a.locator === b.locator;
}

/**
 * File-specific locator overlap (path/glob semantics).
 * Equivalent to the existing pathsOverlap() in file-claim.ts.
 */
function fileLocatorsOverlap(a: string, b: string): boolean {
  const na = a.replace(/\/+$/, "");
  const nb = b.replace(/\/+$/, "");

  if (na === nb) return true;

  if (na.startsWith(nb + "/") || nb.startsWith(na + "/")) return true;

  if (na.endsWith("/*") || na.endsWith("/**")) {
    const prefix = na.replace(/\/\*+$/, "");
    if (nb.startsWith(prefix + "/") || nb === prefix) return true;
  }
  if (nb.endsWith("/*") || nb.endsWith("/**")) {
    const prefix = nb.replace(/\/\*+$/, "");
    if (na.startsWith(prefix + "/") || na === prefix) return true;
  }

  return false;
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

// ── Conversion helpers (FileClaim ↔ ResourceClaim) ─

/**
 * Convert comma-separated file paths to ResourceRef[] with type="file".
 * @deprecated Use `filePathsToResourceRefs` from `syncpoint-plugin-code` instead.
 */
export function filePathsToResourceRefs(paths: string): ResourceRef[] {
  return paths
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => ({ type: "file", locator: p, metadata: "" }));
}

/**
 * Convert ResourceRef[] of type="file" back to comma-separated paths.
 * @deprecated Use `resourceRefsToFilePaths` from `syncpoint-plugin-code` instead.
 */
export function resourceRefsToFilePaths(refs: ResourceRef[]): string {
  return refs
    .filter(r => r.type === "file")
    .map(r => r.locator)
    .join(", ");
}
