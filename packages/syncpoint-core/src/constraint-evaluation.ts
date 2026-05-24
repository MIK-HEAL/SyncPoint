/**
 * Constraint Evaluation — pure constraint checker.
 *
 * Evaluates a RealityProjection against an action context to produce
 * a ConstraintDecision: { permitted, blockers, warnings }.
 *
 * Design principles:
 *   - Pure functions, no I/O, no side effects
 *   - hard_constraint existence alone does NOT block (needs violation evidence)
 *   - do_not_touch with scope overlap DOES block
 *   - projection invalid / blocking conflict DOES block
 *   - Every violation carries sourceMemoryId + projectionId + evidence
 *
 * This is NOT a rules engine or runtime VM. It is a pure function
 * constraint checker. Untyped hard_constraint defaults to advisory.
 * Only typed evaluators or built-in rules can block.
 */

import type {
  RealityProjection,
  ProjectedMemoryItem,
  ProjectionScope,
} from "./reality-projection.js";
import { getScopeMatcher, computeContentHash } from "./reality-projection.js";
import type { ResourceRef } from "./resource.js";

// ── Runtime Spec ─────────────────────────────

/**
 * Constraint rule type string. No longer a closed enum — plugins register
 * evaluators for domain-specific rule types (e.g. "resource_forbidden").
 * Core only knows "require_review" and "custom" as built-ins.
 */
export type ConstraintRuleType = string;

/**
 * Structured rule specification for a hard_constraint.
 * When present on a ProjectedMemoryItem, enables typed evaluation (blocking)
 * instead of generic advisory behavior.
 */
export interface ConstraintRuleSpec {
  rule: ConstraintRuleType;
  /** Optional message override */
  message?: string;
  /** Optional action allowlist — if set, only these actions trigger the constraint. */
  actions?: string[];
}

// ── Pluggable Constraint Rule Evaluator ───────────────

/**
 * A ConstraintEvaluator handles evaluation for a specific rule type.
 * Plugins register evaluators so core never needs domain-specific logic
 * (e.g. file glob matching, resource URI overlap).
 */
export interface ConstraintEvaluator {
  /** The rule type this evaluator handles (e.g. "resource_forbidden"). */
  ruleType: string;
  /**
   * Evaluate the constraint against the input.
   * Return a ConstraintViolation if violated, null if not.
   */
  evaluate(
    input: ConstraintInput,
    item: ProjectedMemoryItem,
    spec: ConstraintRuleSpec,
  ): ConstraintViolation | null;
}

const _ruleEvaluators = new Map<string, ConstraintEvaluator>();

export function registerConstraintEvaluator(e: ConstraintEvaluator): void {
  _ruleEvaluators.set(e.ruleType, e);
}

export function getConstraintEvaluator(ruleType: string): ConstraintEvaluator | undefined {
  return _ruleEvaluators.get(ruleType);
}

export function clearConstraintEvaluatorRegistry(): void {
  _ruleEvaluators.clear();
}

/**
 * Parse a runtime spec from memory content.
 * Supports embedded JSON: `<!-- runtime-spec: {"rule":"resource_forbidden"} -->`
 * Returns null if no spec found.
 */
export function parseRuntimeSpec(content: string): ConstraintRuleSpec | null {
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
 * Parse validator config into a partial spec override.
 */
function parseValidatorConfig(
  config: string | { message?: string; actions?: string[] } | null | undefined,
): { message?: string; actions?: string[] } | null {
  if (!config) return null;
  if (typeof config !== "string") {
    return config;
  }
  try {
    return JSON.parse(config);
  } catch {
    return null;
  }
}

/**
 * Build a runtime spec from a ProjectedMemoryItem's structural fields.
 *
 * Resolution order:
 *   1. Explicit `validatorType` field (from Project Memory schema) — the designed path
 *   2. Embedded `<!-- runtime-spec: {...} -->` in content — compatibility/convenience
 *   3. No inference from scope alone — hard_constraint without validator stays advisory
 */
export function resolveRuntimeSpec(item: ProjectedMemoryItem): ConstraintRuleSpec | null {
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

/** Core built-in rule types (not domain-specific). */
const CORE_RULE_TYPES = ["require_review", "custom"] as const;

/**
 * A rule type is "known" if it's a built-in or if a plugin has registered
 * an evaluator for it.
 */
function isKnownRule(type: string): boolean {
  return (CORE_RULE_TYPES as readonly string[]).includes(type)
    || _ruleEvaluators.has(type);
}

/**
 * Check if a constraint rule type is known to the runtime.
 * Returns true for core built-ins ("require_review", "custom") and
 * any rule type that has a registered ConstraintRuleEvaluator from a plugin.
 *
 * Used by the server to validate `validatorType` on Project Memory creation
 * without maintaining a hardcoded allowlist.
 */
export function isConstraintRuleKnown(type: string): boolean {
  return isKnownRule(type);
}

// ── Types ────────────────────────────────────────────────

/** Actions that the runtime can evaluate. */
export type ConstraintAction =
  | "resume"
  | "start_assignment"
  | "wake_start"
  | "operation_submit"
  | "operation_apply";

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

/**
 * ConstraintManifest — a tamper-evident record of the constraint evaluation
 * that produced a decision. Captures what was evaluated, the inputs, and a
 * hash for integrity verification.
 */
export interface ConstraintManifest {
  /** Projection that was evaluated */
  projectionId: string;
  /** Memory version the projection was built from */
  memoryVersion: number;
  /** Action being evaluated */
  action: ConstraintAction;
  /** Constraint rules that were evaluated (sourceMemoryId + rule pairs) */
  evaluatedRules: Array<{ sourceMemoryId: string; rule: string }>;
  /** Resources that were checked against scopes */
  touchedResources: string[];
  /** The decision: permitted or not */
  permitted: boolean;
  /** Number of blockers / warnings */
  blockerCount: number;
  warningCount: number;
  /** SHA-256 hash of manifest fields for integrity */
  hash: string;
  /** ISO timestamp */
  evaluatedAt: string;
}

/**
 * Build a ConstraintManifest from a decision and its inputs.
 * This provides an auditable, hashable record of what was enforced.
 */
export function buildConstraintManifest(
  input: ConstraintInput,
  decision: ConstraintDecision,
): ConstraintManifest {
  const touchedResources = (input.touchedResources ?? []).map(r => r.locator);
  const evaluatedRules = [
    ...decision.blockers.map(b => ({ sourceMemoryId: b.sourceMemoryId, rule: b.rule })),
    ...decision.warnings.map(w => ({ sourceMemoryId: w.sourceMemoryId, rule: w.rule })),
  ];

  const hashPayload = [
    decision.projectionId,
    String(input.projection.createdFrom.memoryVersion),
    input.action,
    JSON.stringify(evaluatedRules),
    touchedResources.join(","),
    String(decision.permitted),
    String(decision.blockers.length),
    String(decision.warnings.length),
  ].join("|");

  return {
    projectionId: decision.projectionId,
    memoryVersion: input.projection.createdFrom.memoryVersion,
    action: input.action,
    evaluatedRules,
    touchedResources,
    permitted: decision.permitted,
    blockerCount: decision.blockers.length,
    warningCount: decision.warnings.length,
    hash: computeContentHash(hashPayload),
    evaluatedAt: new Date().toISOString(),
  };
}

/** Input context for constraint evaluation. */
export interface ConstraintInput {
  action: ConstraintAction;
  projection: RealityProjection;
  /** Resources touched by current action (patch, assignment, etc.) */
  touchedResources?: ResourceRef[];
  /** Whether snapshot validation passed (for locked-mode gate). */
  snapshotValid?: boolean;
  /** Protocol gate blockers already computed upstream. */
  protocolGateBlockers?: string[];
}

// ── Scope overlap helpers ───────────────────────────

/**
 * Find all touched resources that overlap with a constraint's scope,
 * checking every scope field via registered ScopeMatchers.
 *
 * Resource-type-aware: if a ScopeMatcher declares `resourceTypes`,
 * only resources of those types are checked against that scope field.
 * This prevents cross-domain false positives (e.g. a binary_asset
 * locator accidentally matching a `files` scope pattern).
 *
 * Falls back to exact match if no matcher is registered.
 */
function findAllScopeOverlaps(resources: ResourceRef[], scope: ProjectionScope | undefined): string[] {
  if (!scope || !resources.length) return [];
  const overlaps = new Set<string>();
  for (const [field, patterns] of Object.entries(scope)) {
    if (!patterns?.length) continue;
    const matcher = getScopeMatcher(field);
    // Pre-filter resources by the matcher's declared resource types
    const filtered = matcher?.resourceTypes?.length
      ? resources.filter(r => matcher.resourceTypes!.includes(r.type))
      : resources;
    const locators = filtered.map(r => r.locator);
    if (!locators.length) continue;
    const hits = matcher
      ? matcher.findOverlaps(patterns, locators)
      : locators.filter(loc => patterns.includes(loc)); // exact match fallback
    for (const h of hits) overlaps.add(h);
  }
  return [...overlaps];
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

function evaluateDoNotTouchScopeOverlap(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  const resources = input.touchedResources;
  if (!resources?.length) return;

  const doNotTouchRules = input.projection.constraintRules.filter(isDoNotTouch);

  for (const item of doNotTouchRules) {
    const overlaps = findAllScopeOverlaps(resources, item.scope);
    if (overlaps.length > 0) {
      blockers.push({
        rule: "do_not_touch_scope_overlap",
        sourceMemoryId: item.source.sourceMemoryId,
        projectionId: input.projection.projectionId,
        message: `Resource(s) touch protected scope "${item.title}": ${overlaps.join(", ")}`,
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

function evaluateSnapshotLockedInvalid(
  input: ConstraintInput,
  blockers: ConstraintViolation[],
): void {
  if (input.snapshotValid === false) {
    blockers.push({
      rule: "snapshot_locked_invalid",
      sourceMemoryId: "",
      projectionId: input.projection.projectionId,
      message: "Snapshot validation failed in locked context mode.",
    });
  }
}

/**
 * Evaluate hard_constraint items that have a typed runtimeSpec.
 * These can produce blockers (not just advisory) when violation evidence exists.
 *
 * Core handles "require_review" and "custom" built-ins.
 * Domain-specific rules (e.g. "resource_forbidden") dispatch to plugin evaluators.
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
      case "require_review": {
        claimed = true;
        // Block unless action itself is a review-related operation
        if (input.action !== "operation_submit" && input.action !== "operation_apply") break;
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
      default: {
        // Dispatch to plugin evaluator
        const evaluator = _ruleEvaluators.get(spec.rule);
        if (evaluator) {
          claimed = true;
          const violation = evaluator.evaluate(input, cr, spec);
          if (violation) {
            blockers.push(violation);
          }
        }
        // If no evaluator registered, fall through to advisory
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
function isDoNotTouch(cr: ProjectedMemoryItem): boolean {
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

  // 2. Scope-level enforcement (do_not_touch)
  evaluateDoNotTouchScopeOverlap(input, blockers);

  // 3. Protocol gate passthrough
  evaluateProtocolGateBlocked(input, blockers);

  // 4. Snapshot locked-mode validation
  evaluateSnapshotLockedInvalid(input, blockers);

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
