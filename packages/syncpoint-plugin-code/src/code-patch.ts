/**
 * Code patch helpers — diff parsing, format validation, claim coverage,
 * and conflict checking for code_patch operations.
 *
 * These functions own the "code_patch" operation type semantics that were
 * previously embedded in syncpoint-core's patch-proposal.ts.
 */

import type { ResourceClaim } from "syncpoint-core";
import { ResourceClaimMode } from "syncpoint-core";
import { pathsOverlap } from "./file-resource.js";

// ── Check result types ─────────────────────────────

export interface CodePatchCheckItem {
  check: string;
  passed: boolean;
  detail: string;
}

export interface CodePatchCheckResult {
  allPassed: boolean;
  items: CodePatchCheckItem[];
  touchedFiles: string[];
  uncoveredFiles: string[];
  conflictingClaims: string[];
}

// ── Diff parsing ────────────────────────────────────

/**
 * Extract touched file paths from a unified diff patch text.
 * Looks for lines starting with --- a/ or +++ b/ or diff --git.
 */
export function extractTouchedFiles(patchText: string): string[] {
  const files = new Set<string>();
  const lines = patchText.split("\n");

  for (const line of lines) {
    // diff --git a/path b/path
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch) {
      files.add(gitMatch[2]);
      continue;
    }
    // +++ b/path (new file)
    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch && plusMatch[1] !== "/dev/null") {
      files.add(plusMatch[1]);
      continue;
    }
    // --- a/path (old file)
    const minusMatch = line.match(/^--- a\/(.+)$/);
    if (minusMatch && minusMatch[1] !== "/dev/null") {
      files.add(minusMatch[1]);
      continue;
    }
  }

  return [...files];
}

/**
 * Check if a patch text looks like a valid unified diff.
 */
export function isValidPatchFormat(patchText: string): boolean {
  if (!patchText.trim()) return false;
  return /^(diff --git|---|\+\+\+|@@)/m.test(patchText);
}

// ── Claim coverage ──────────────────────────────────

/**
 * Check which touched files are NOT covered by the agent's active resource claims.
 */
export function findUncoveredFiles(
  touchedFiles: string[],
  agentClaims: ResourceClaim[],
): string[] {
  const activeClaims = agentClaims.filter(c => c.status === "ACTIVE");
  return touchedFiles.filter(file => {
    return !activeClaims.some(claim => {
      const claimPaths = claim.resources
        .filter(r => r.type === "file")
        .map(r => r.locator);
      return claimPaths.some(cp => pathsOverlap(cp, file));
    });
  });
}

/**
 * Find active resource claims from OTHER agents that conflict with the touched files.
 */
export function findConflictingClaims(
  touchedFiles: string[],
  agentId: string,
  allActiveClaims: ResourceClaim[],
): ResourceClaim[] {
  return allActiveClaims.filter(claim => {
    if (claim.actorId === agentId) return false;
    if (claim.mode !== ResourceClaimMode.EXCLUSIVE) return false;
    const claimPaths = claim.resources
      .filter(r => r.type === "file")
      .map(r => r.locator);
    return touchedFiles.some(file =>
      claimPaths.some(cp => pathsOverlap(cp, file)),
    );
  });
}

// ── Combined check ──────────────────────────────────

/**
 * Run all code patch checks and return a combined result.
 */
export function runCodePatchChecks(opts: {
  patchText: string;
  touchedFiles: string[];
  agentId: string;
  agentClaims: ResourceClaim[];
  allActiveClaims: ResourceClaim[];
}): CodePatchCheckResult {
  const items: CodePatchCheckItem[] = [];

  // 1. Valid patch format
  const formatValid = isValidPatchFormat(opts.patchText);
  items.push({
    check: "patch_format_valid",
    passed: formatValid,
    detail: formatValid
      ? "Patch format is valid unified diff"
      : "Patch does not appear to be a valid unified diff",
  });

  // 2. Files extracted
  items.push({
    check: "files_extracted",
    passed: opts.touchedFiles.length > 0,
    detail: opts.touchedFiles.length > 0
      ? `${opts.touchedFiles.length} file(s): ${opts.touchedFiles.join(", ")}`
      : "No files could be extracted from patch",
  });

  // 3. Files covered by agent's claims
  const uncovered = findUncoveredFiles(opts.touchedFiles, opts.agentClaims);
  items.push({
    check: "files_covered_by_claims",
    passed: uncovered.length === 0,
    detail: uncovered.length === 0
      ? "All touched files are covered by agent's active claims"
      : `Uncovered files: ${uncovered.join(", ")}`,
  });

  // 4. No hard conflict with other active claims
  const conflicting = findConflictingClaims(opts.touchedFiles, opts.agentId, opts.allActiveClaims);
  items.push({
    check: "no_hard_conflict",
    passed: conflicting.length === 0,
    detail: conflicting.length === 0
      ? "No hard conflicts with other agents' exclusive claims"
      : `Conflicts with ${conflicting.length} claim(s): ${conflicting.map(c => c.id).join(", ")}`,
  });

  return {
    allPassed: items.every(i => i.passed),
    items,
    touchedFiles: opts.touchedFiles,
    uncoveredFiles: uncovered,
    conflictingClaims: conflicting.map(c => c.id),
  };
}
