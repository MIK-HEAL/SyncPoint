/**
 * FileClaim — file ownership and conflict awareness.
 *
 * Agents declare which files/globs they intend to modify.
 * When claims overlap, the system detects a conflict and
 * suggests a sync gate.
 */

import { z } from "zod";

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

/**
 * Detect conflicts between a set of active file claims.
 * Returns all pairs of claims that have overlapping paths.
 */
export function detectConflicts(claims: FileClaim[]): FileConflict[] {
  const active = claims.filter(c => c.status === FileClaimStatus.ACTIVE);
  const conflicts: FileConflict[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      // Same agent on same task — not a conflict
      if (a.agentId === b.agentId && a.taskId === b.taskId) continue;

      const pathsA = parseClaimPaths(a.paths);
      const pathsB = parseClaimPaths(b.paths);

      for (const pa of pathsA) {
        for (const pb of pathsB) {
          if (pathsOverlap(pa, pb)) {
            conflicts.push({
              overlappingPath: `${pa} ↔ ${pb}`,
              claimA: a,
              claimB: b,
              isHardConflict:
                a.mode === FileClaimMode.EXCLUSIVE ||
                b.mode === FileClaimMode.EXCLUSIVE,
            });
          }
        }
      }
    }
  }

  return conflicts;
}
