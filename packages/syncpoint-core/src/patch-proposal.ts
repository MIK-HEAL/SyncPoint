/**
 * PatchProposal — AI submits patch proposals for ownership/conflict
 * checks before application.
 *
 * Lifecycle: DRAFT → SUBMITTED → APPROVED/REJECTED/CONFLICTING → APPLIED/CANCELLED
 */

import { z } from "zod";

// ── Status ──────────────────────────────────────────

export enum PatchProposalStatus {
  DRAFT = "DRAFT",
  SUBMITTED = "SUBMITTED",
  CONFLICTING = "CONFLICTING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  APPLIED = "APPLIED",
  CANCELLED = "CANCELLED",
}

// ── Transitions ─────────────────────────────────────

const PATCH_TRANSITIONS: Record<PatchProposalStatus, PatchProposalStatus[]> = {
  [PatchProposalStatus.DRAFT]: [PatchProposalStatus.SUBMITTED, PatchProposalStatus.CANCELLED],
  [PatchProposalStatus.SUBMITTED]: [
    PatchProposalStatus.APPROVED,
    PatchProposalStatus.REJECTED,
    PatchProposalStatus.CONFLICTING,
    PatchProposalStatus.CANCELLED,
  ],
  [PatchProposalStatus.CONFLICTING]: [
    PatchProposalStatus.SUBMITTED, // resubmit after fixing
    PatchProposalStatus.CANCELLED,
  ],
  [PatchProposalStatus.APPROVED]: [PatchProposalStatus.APPLIED, PatchProposalStatus.CANCELLED],
  [PatchProposalStatus.REJECTED]: [PatchProposalStatus.SUBMITTED, PatchProposalStatus.CANCELLED], // resubmit
  [PatchProposalStatus.APPLIED]: [],
  [PatchProposalStatus.CANCELLED]: [],
};

export function validatePatchTransition(
  from: PatchProposalStatus,
  to: PatchProposalStatus,
): boolean {
  return (PATCH_TRANSITIONS[from] ?? []).includes(to);
}

// ── Schema ──────────────────────────────────────────

export const PatchProposalSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  taskId: z.string(),
  agentId: z.string(),
  title: z.string(),
  summary: z.string(),
  patchText: z.string(),
  touchedFiles: z.string(), // comma-separated
  relatedClaimIds: z.string(),
  status: z.string(),
  checkResult: z.string(), // JSON stringified check result
  decisionSummary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PatchProposal = z.infer<typeof PatchProposalSchema>;

export const PatchProposalCreateSchema = z.object({
  sessionId: z.string(),
  taskId: z.string(),
  agentId: z.string(),
  title: z.string().min(1),
  summary: z.string().default(""),
  patchText: z.string().min(1),
});

export type PatchProposalCreate = z.infer<typeof PatchProposalCreateSchema>;

// ── Check result ────────────────────────────────────

export interface PatchCheckItem {
  check: string;
  passed: boolean;
  detail: string;
}

export interface PatchCheckResult {
  allPassed: boolean;
  items: PatchCheckItem[];
  touchedFiles: string[];
  uncoveredFiles: string[];
  conflictingClaims: string[];
  /** P4B: constraint violations from Constraint Runtime (do_not_touch, projection invalid, etc.) */
  constraintViolations?: Array<{
    rule: string;
    sourceMemoryId: string;
    projectionId: string;
    message: string;
    evidence?: string[];
  }>;
}

// ── Pure helpers ────────────────────────────────────

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
  // Must contain at least one diff header or hunk header
  return /^(diff --git|---|\+\+\+|@@)/m.test(patchText);
}

import type { FileClaim } from "./file-claim.js";
import { parseClaimPaths, pathsOverlap, FileClaimMode } from "./file-claim.js";

/**
 * Check which touched files are NOT covered by the agent's active claims.
 */
export function findUncoveredFiles(
  touchedFiles: string[],
  agentClaims: FileClaim[],
): string[] {
  const activeClaims = agentClaims.filter(c => c.status === "ACTIVE");
  return touchedFiles.filter(file => {
    return !activeClaims.some(claim => {
      const claimPaths = parseClaimPaths(claim.paths);
      return claimPaths.some(cp => pathsOverlap(cp, file));
    });
  });
}

/**
 * Find active claims from OTHER agents that conflict with the touched files.
 */
export function findConflictingClaims(
  touchedFiles: string[],
  agentId: string,
  allActiveClaims: FileClaim[],
): FileClaim[] {
  return allActiveClaims.filter(claim => {
    if (claim.agentId === agentId) return false;
    if (claim.mode !== FileClaimMode.EXCLUSIVE) return false;
    const claimPaths = parseClaimPaths(claim.paths);
    return touchedFiles.some(file =>
      claimPaths.some(cp => pathsOverlap(cp, file)),
    );
  });
}

/**
 * Run all patch checks and return a combined result.
 */
export function runPatchChecks(opts: {
  patchText: string;
  touchedFiles: string[];
  agentId: string;
  agentClaims: FileClaim[];
  allActiveClaims: FileClaim[];
}): PatchCheckResult {
  const items: PatchCheckItem[] = [];

  // 1. Valid patch format
  const formatValid = isValidPatchFormat(opts.patchText);
  items.push({
    check: "patch_format_valid",
    passed: formatValid,
    detail: formatValid ? "Patch format is valid unified diff" : "Patch does not appear to be a valid unified diff",
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
