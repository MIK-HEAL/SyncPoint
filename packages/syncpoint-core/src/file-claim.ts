/**
 * FileClaim — file ownership and conflict awareness.
 *
 * Agents declare which files/globs they intend to modify.
 * When claims overlap, the system detects a conflict and
 * suggests a sync gate.
 */

import { z } from "zod";
import type { ResourceClaim, ResourceConflict } from "./resource.js";
import {
  ResourceClaimStatus,
  ResourceClaimMode,
  filePathsToResourceRefs,
  detectResourceClaimConflicts,
} from "./resource.js";

// ── Status ──────────────────────────────────────────

export enum FileClaimStatus {
  ACTIVE = "ACTIVE",
  RELEASED = "RELEASED",
}

// ── Mode ────────────────────────────────────────────

export enum FileClaimMode {
  /** Only this agent may modify these paths */
  EXCLUSIVE = "exclusive",
  /** Multiple agents may modify, but aware of overlap */
  SHARED = "shared",
}

// ── Schema ──────────────────────────────────────────

export const FileClaimSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  sessionId: z.string().default(""),
  /** Comma-separated file paths or glob patterns */
  paths: z.string(),
  mode: z.nativeEnum(FileClaimMode),
  status: z.nativeEnum(FileClaimStatus),
  createdAt: z.string(),
  releasedAt: z.string(),
});

export type FileClaim = z.infer<typeof FileClaimSchema>;

export const FileClaimCreateSchema = z.object({
  agentId: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  paths: z.string(),
  mode: z.nativeEnum(FileClaimMode).default(FileClaimMode.EXCLUSIVE),
});

export type FileClaimCreate = z.infer<typeof FileClaimCreateSchema>;

// ── Conflict ────────────────────────────────────────

export interface FileConflict {
  /** The path or glob pattern that overlaps */
  overlappingPath: string;
  claimA: FileClaim;
  claimB: FileClaim;
  /** True when at least one side is EXCLUSIVE */
  isHardConflict: boolean;
}

// ── Pure functions ──────────────────────────────────

/**
 * Parse a FileClaim's paths field into an array of normalized patterns.
 * @deprecated Use `parseClaimPaths` from `syncpoint-plugin-code` instead.
 */
export function parseClaimPaths(paths: string): string[] {
  return paths
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Check if two path patterns overlap.
 * Handles exact matches, prefix directories, and simple glob patterns.
 * @deprecated Use `pathsOverlap` from `syncpoint-plugin-code` instead.
 */
export function pathsOverlap(a: string, b: string): boolean {
  // Normalize trailing slashes
  const na = a.replace(/\/+$/, "");
  const nb = b.replace(/\/+$/, "");

  // Exact match
  if (na === nb) return true;

  // One is a prefix directory of the other (e.g., "src/" vs "src/auth.ts")
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

// ── FileClaim ↔ ResourceClaim conversion ────────────

/**
 * Convert a FileClaim to a generic ResourceClaim.
 * @deprecated Use `fileClaimToResourceClaim` from `syncpoint-plugin-code` instead.
 */
export function fileClaimToResourceClaim(fc: FileClaim): ResourceClaim {
  return {
    id: fc.id,
    actorId: fc.agentId,
    taskId: fc.taskId,
    sessionId: fc.sessionId,
    resources: filePathsToResourceRefs(fc.paths),
    mode: fc.mode === FileClaimMode.EXCLUSIVE
      ? ResourceClaimMode.EXCLUSIVE
      : ResourceClaimMode.SHARED,
    status: fc.status === FileClaimStatus.ACTIVE
      ? ResourceClaimStatus.ACTIVE
      : ResourceClaimStatus.RELEASED,
    createdAt: fc.createdAt,
    releasedAt: fc.releasedAt,
  };
}

/**
 * Convert a generic ResourceConflict back to a FileConflict.
 * @deprecated Use `resourceConflictToFileConflict` from `syncpoint-plugin-code` instead.
 */
export function resourceConflictToFileConflict(
  rc: ResourceConflict,
  claimLookup: Map<string, FileClaim>,
): FileConflict {
  return {
    overlappingPath: rc.overlappingLocator,
    claimA: claimLookup.get(rc.claimA.id)!,
    claimB: claimLookup.get(rc.claimB.id)!,
    isHardConflict: rc.isHardConflict,
  };
}

/**
 * Detect conflicts between a set of active file claims.
 * Returns all pairs of claims that have overlapping paths.
 *
 * Internally delegates to generic detectResourceClaimConflicts().
 * @deprecated Use generic `detectResourceClaimConflicts` from core or plugin-level conflict detection.
 */
export function detectConflicts(claims: FileClaim[]): FileConflict[] {
  // Build lookup map and convert to ResourceClaim[]
  const lookup = new Map<string, FileClaim>();
  const resourceClaims: ResourceClaim[] = [];
  for (const fc of claims) {
    lookup.set(fc.id, fc);
    resourceClaims.push(fileClaimToResourceClaim(fc));
  }

  // Delegate to generic conflict detection
  const genericConflicts = detectResourceClaimConflicts(resourceClaims);

  // Convert back to FileConflict[]
  return genericConflicts.map(gc => resourceConflictToFileConflict(gc, lookup));
}
