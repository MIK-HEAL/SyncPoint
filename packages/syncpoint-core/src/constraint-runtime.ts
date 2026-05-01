/**
 * P4A — Constraint Runtime (pure evaluation layer).
 *
 * Evaluates a ProjectedReality against an action context to produce
 * a ConstraintDecision: { permitted, blockers, warnings }.
 *
 * Design principles:
 *   - Pure functions, no I/O, no side effects
 *   - hard_constraint existence alone does NOT block (needs violation evidence)
 *   - do_not_touch with file overlap DOES block
 *   - projection invalid / blocking conflict DOES block
 *   - Every violation carries sourceMemoryId + projectionId + evidence
 */

import type {
  ProjectedReality,
  ProjectionItem,
  ProjectionScope,
} from "./projection.js";

// ── Types ────────────────────────────────────────────────

/** Actions that the runtime can evaluate. */
export type RuntimeAction =
  | "resume"
  | "start_assignment"
  | "wake_start"
  | "patch_submit"
  | "patch_apply";

/** A single constraint violation (blocker or warning). */
export interface ConstraintViolation {
  rule: string;
  sourceMemoryId: string;
  projectionId: string;
  message: string;
  /** Evidence that triggered the violation (e.g. matched files). */
  evidence?: string[];
}

/** The runtime's decision for a given action. */
export interface ConstraintDecision {
  permitted: boolean;
  blockers: ConstraintViolation[];
  warnings: ConstraintViolation[];
  projectionId: string;
}

/** Input context for constraint evaluation. */
export interface ConstraintInput {
  action: RuntimeAction;
  projection: ProjectedReality;
  /** Files touched by current action (patch, assignment, etc.) */
  touchedFiles?: string[];
  /** Whether capsule validation passed (for locked-mode gate). */
  capsuleValid?: boolean;
  /** Protocol gate blockers already computed upstream. */
  protocolGateBlockers?: string[];
}

// ── File matching ────────────────────────────────────────

/**
 * Check if a touched file matches any of the scope file patterns.
 * Patterns may be exact paths or prefix globs (e.g. "src/auth/**").
 */
function fileMatchesScope(touchedFile: string, scopeFiles: string[]): boolean {
  for (const pattern of scopeFiles) {
    const prefix = pattern.replace(/\*\*?\/?$/, "");
    if (touchedFile === pattern || touchedFile.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Find all touched files that overlap with a constraint's scope.
 */
function findFileOverlaps(touchedFiles: string[], scope: ProjectionScope | undefined): string[] {
  if (!scope?.files?.length || !touchedFiles.length) return [];
  return touchedFiles.filter(f => fileMatchesScope(f, scope.files!));
}

// ── Evaluators ───────────────────────────────────────────

function evaluateProjectionInvalid(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  if (input.projection.projectionValidity === "invalid") {
    blockers.push({
      rule: "projection_invalid",
      sourceMemoryId: "",
      projectionId: input.projection.projectionId,
      message: "Projection validity is 'invalid' — cannot proceed until revalidated.",
    });
  }
}

function evaluateProjectionConflicts(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  for (const conflict of input.projection.conflicts) {
    blockers.push({
      rule: "projection_conflict",
      sourceMemoryId: conflict.itemA.sourceMemoryId,
      projectionId: input.projection.projectionId,
      message: conflict.description,
      evidence: [conflict.itemA.sourceMemoryId, conflict.itemB.sourceMemoryId],
    });
  }
}

function evaluateDoNotTouchFileOverlap(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  if (!input.touchedFiles?.length) return;

  // Consume constraintRules — the runtime bucket — not capsulePatch.
  // do_not_touch items are dual-written with "P4 enforcement" reason.
  const doNotTouchRules = input.projection.constraintRules.filter(
    cr => cr.source.projectionReason.includes("P4 enforcement"),
  );

  for (const item of doNotTouchRules) {
    const overlaps = findFileOverlaps(input.touchedFiles, item.scope);
    if (overlaps.length > 0) {
      blockers.push({
        rule: "do_not_touch_file_overlap",
        sourceMemoryId: item.source.sourceMemoryId,
        projectionId: input.projection.projectionId,
        message: `File(s) touch protected scope "${item.title}": ${overlaps.join(", ")}`,
        evidence: overlaps,
      });
    }
  }
}

function evaluateProtocolGateBlocked(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  if (!input.protocolGateBlockers?.length) return;

  for (const msg of input.protocolGateBlockers) {
    blockers.push({
      rule: "protocol_gate_blocked",
      sourceMemoryId: "",
      projectionId: input.projection.projectionId,
      message: msg,
    });
  }
}

function evaluateCapsuleLockedInvalid(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  if (input.capsuleValid === false) {
    blockers.push({
      rule: "capsule_locked_invalid",
      sourceMemoryId: "",
      projectionId: input.projection.projectionId,
      message: "Capsule validation failed in locked context mode.",
    });
  }
}

function evaluateHardConstraintAdvisory(
  input: ConstraintInput,
  warnings: ConstraintViolation[],
): void {
  // hard_constraint items exist in constraintRules.
  // Those WITHOUT do_not_touch origin are advisory — existence alone does NOT block.
  // Filter out dual-written do_not_touch items (they have their own evaluator).
  for (const cr of input.projection.constraintRules) {
    if (cr.source.projectionReason.includes("P4 enforcement")) continue; // do_not_touch dual-write
    warnings.push({
      rule: "hard_constraint_advisory",
      sourceMemoryId: cr.source.sourceMemoryId,
      projectionId: input.projection.projectionId,
      message: `Constraint awareness: ${cr.title}`,
    });
  }
}

// ── Main evaluator ───────────────────────────────────────

/**
 * Evaluate all constraints against the given action context.
 * Returns a ConstraintDecision with blockers and warnings.
 *
 * Blockers → permitted = false. Warnings → permitted = true.
 */
export function evaluateConstraints(input: ConstraintInput): ConstraintDecision {
  const blockers: ConstraintViolation[] = [];
  const warnings: ConstraintViolation[] = [];

  // 1. Projection-level gates
  evaluateProjectionInvalid(input, blockers);
  evaluateProjectionConflicts(input, blockers);

  // 2. File-level enforcement
  evaluateDoNotTouchFileOverlap(input, blockers);

  // 3. Protocol gate passthrough
  evaluateProtocolGateBlocked(input, blockers);

  // 4. Capsule locked-mode validation
  evaluateCapsuleLockedInvalid(input, blockers);

  // 5. Advisory warnings for hard constraints (existence alone ≠ block)
  evaluateHardConstraintAdvisory(input, warnings);

  return {
    permitted: blockers.length === 0,
    blockers,
    warnings,
    projectionId: input.projection.projectionId,
  };
}
