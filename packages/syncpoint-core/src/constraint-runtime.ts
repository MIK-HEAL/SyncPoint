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

// ── Runtime Spec ─────────────────────────────────

/** Typed constraint rule types that can be validated at runtime. */
export type ConstraintRuleType =
  | "file_forbidden"      // files in scope are forbidden for the action
  | "module_forbidden"    // modules in scope are forbidden
  | "require_review"      // action requires prior review approval
  | "custom";             // opaque user-defined rule (future extensibility)

/**
 * Structured runtime specification for a hard_constraint.
 * When present on a ProjectionItem, enables typed evaluation (blocking)
 * instead of generic advisory behavior.
 */
export interface ConstraintRuntimeSpec {
  rule: ConstraintRuleType;
  /** Optional message override */
  message?: string;
  /** Optional action allowlist — if set, only these actions trigger the constraint. */
  actions?: string[];
}

/**
 * Parse a runtime spec from memory content.
 * Supports embedded JSON: `<!-- runtime-spec: {"rule":"file_forbidden"} -->`
 * Returns null if no spec found.
 */
export function parseRuntimeSpec(content: string): ConstraintRuntimeSpec | null {
  const match = content.match(/<!--\s*runtime-spec:\s*(\{[^}]+\})\s*-->/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed.rule === "string") {
      return { rule: parsed.rule as ConstraintRuleType, message: parsed.message };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse validator config JSON string into a partial spec override.
 * Expected format: `{"message":"...", "actions":["patch_submit"]}`
 */
function parseValidatorConfig(config: string | undefined): { message?: string; actions?: string[] } | null {
  if (!config) return null;
  try {
    return JSON.parse(config);
  } catch {
    return null;
  }
}

/**
 * Build a runtime spec from a ProjectionItem's structural fields.
 *
 * Resolution order:
 *   1. Explicit `validatorType` field (from Project Memory schema) — the designed path
 *   2. Embedded `<!-- runtime-spec: {...} -->` in content — compatibility/convenience
 *   3. No inference from scope alone — hard_constraint without validator stays advisory
 */
export function resolveRuntimeSpec(item: ProjectionItem): ConstraintRuntimeSpec | null {
  // 1. Explicit validatorType from schema
  if (item.validatorType && isKnownRule(item.validatorType)) {
    const config = parseValidatorConfig(item.validatorConfig);
    return {
      rule: item.validatorType as ConstraintRuleType,
      message: config?.message,
      actions: config?.actions,
    };
  }

  // 2. Embedded spec in content (backward compat / convenience)
  const embedded = parseRuntimeSpec(item.content);
  if (embedded) return embedded;

  // 3. No inference from scope — preserves "hard_constraint without validator = advisory"
  return null;
}

function isKnownRule(type: string): boolean {
  return type === "file_forbidden"
    || type === "module_forbidden"
    || type === "require_review"
    || type === "custom";
}

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
  // Identify do_not_touch items by structural kind (preferred) or legacy reason-string fallback.
  const doNotTouchRules = input.projection.constraintRules.filter(isDoNotTouch);

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

/**
 * Evaluate hard_constraint items that have a typed runtimeSpec.
 * These can produce blockers (not just advisory) when violation evidence exists.
 */
function evaluateHardConstraintTyped(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
  typedIds: Set<string>,
): void {
  for (const cr of input.projection.constraintRules) {
    if (isDoNotTouch(cr)) continue;

    const spec = resolveRuntimeSpec(cr);
    if (!spec) continue;

    // Action allowlist: if spec.actions is set, only evaluate for matching actions
    if (spec.actions?.length && !spec.actions.includes(input.action)) {
      // Not applicable for this action — leave for advisory
      continue;
    }

    let claimed = false;

    switch (spec.rule) {
      case "file_forbidden": {
        claimed = true;
        if (!input.touchedFiles?.length) break;
        const overlaps = findFileOverlaps(input.touchedFiles, cr.scope);
        if (overlaps.length > 0) {
          blockers.push({
            rule: "hard_constraint_file_forbidden",
            sourceMemoryId: cr.source.sourceMemoryId,
            projectionId: input.projection.projectionId,
            message: spec.message ?? `Constraint "${cr.title}" forbids files: ${overlaps.join(", ")}`,
            evidence: overlaps,
          });
        }
        break;
      }
      case "module_forbidden": {
        claimed = true;
        if (!input.touchedFiles?.length) break;
        // Use module scope for matching against touched files as module prefixes
        const moduleFiles = cr.scope?.modules ?? [];
        if (moduleFiles.length === 0) break;
        const matches = input.touchedFiles.filter(f =>
          moduleFiles.some(mod => f.startsWith(mod + "/") || f === mod),
        );
        if (matches.length > 0) {
          blockers.push({
            rule: "hard_constraint_module_forbidden",
            sourceMemoryId: cr.source.sourceMemoryId,
            projectionId: input.projection.projectionId,
            message: spec.message ?? `Constraint "${cr.title}" forbids modules: ${matches.join(", ")}`,
            evidence: matches,
          });
        }
        break;
      }
      case "require_review": {
        claimed = true;
        // Block unless action itself is a review-related operation
        if (input.action !== "patch_submit" && input.action !== "patch_apply") break;
        blockers.push({
          rule: "hard_constraint_require_review",
          sourceMemoryId: cr.source.sourceMemoryId,
          projectionId: input.projection.projectionId,
          message: spec.message ?? `Constraint "${cr.title}" requires review before this action.`,
        });
        break;
      }
      case "custom": {
        // Custom rules → not claimed → fall through to advisory
        break;
      }
    }

    // Only exclude from advisory if the rule was actually claimed by this evaluator
    if (claimed) {
      typedIds.add(cr.source.sourceMemoryId);
    }
  }
}

/** Check if item is a do_not_touch (handled by its own evaluator). */
function isDoNotTouch(cr: ProjectionItem): boolean {
  return cr.kind === "do_not_touch"
    || cr.source.projectionReason.includes("dual-write")
    || cr.source.projectionReason.includes("P4 enforcement");
}

/**
 * Advisory warnings for hard_constraint items without typed runtimeSpec.
 * Items that were already evaluated by the typed evaluator are excluded.
 */
function evaluateHardConstraintAdvisory(
  input: ConstraintInput,
  warnings: ConstraintViolation[],
  typedIds: Set<string>,
): void {
  for (const cr of input.projection.constraintRules) {
    if (isDoNotTouch(cr)) continue;
    if (typedIds.has(cr.source.sourceMemoryId)) continue;
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

  // 5. Typed hard constraint evaluation (runtimeSpec → blocking)
  const typedIds = new Set<string>();
  evaluateHardConstraintTyped(input, blockers, typedIds);

  // 6. Advisory warnings for hard constraints without runtimeSpec
  evaluateHardConstraintAdvisory(input, warnings, typedIds);

  return {
    permitted: blockers.length === 0,
    blockers,
    warnings,
    projectionId: input.projection.projectionId,
  };
}
