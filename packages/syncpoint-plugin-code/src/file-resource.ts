/**
 * File resource helpers — path parsing, overlap detection, and
 * ResourceRef conversion for type="file" resources.
 *
 * These functions own the "file" resource type semantics that were
 * previously embedded in syncpoint-core's file-claim.ts and resource.ts.
 */

import type { ResourceRef } from "syncpoint-core";

// ── Path parsing ────────────────────────────────────

/**
 * Parse a comma-separated paths string into an array of normalized patterns.
 */
export function parseClaimPaths(paths: string): string[] {
  return paths
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// ── Overlap detection ───────────────────────────────

/**
 * Check if two file path patterns overlap.
 * Handles exact matches, prefix directories, and simple glob patterns.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const na = a.replace(/\/+$/, "");
  const nb = b.replace(/\/+$/, "");

  // Exact match
  if (na === nb) return true;

  // One is a prefix directory of the other
  if (na.startsWith(nb + "/") || nb.startsWith(na + "/")) return true;

  // Simple glob: "src/*" overlaps with "src/auth.ts"
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

// ── ResourceRef conversion ──────────────────────────

/**
 * Convert comma-separated file paths to ResourceRef[] with type="file".
 */
export function filePathsToResourceRefs(paths: string): ResourceRef[] {
  return parseClaimPaths(paths).map(p => ({
    type: "file",
    locator: p,
    metadata: "",
  }));
}

/**
 * Convert ResourceRef[] of type="file" back to comma-separated paths.
 */
export function resourceRefsToFilePaths(refs: ResourceRef[]): string {
  return refs
    .filter(r => r.type === "file")
    .map(r => r.locator)
    .join(", ");
}
