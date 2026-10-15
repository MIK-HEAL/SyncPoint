import type { RealityProjection, ProjectedMemoryItem } from "syncpoint-context";
import { computeContentHash } from "syncpoint-context";
import type { ResourceRef } from "syncpoint-kernel";
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
 *   1. Explicit `validatorType` field (from Project Memory schema) — the only path
 *   2. No inference from scope alone — hard_constraint without validator stays advisory
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

  // 2. No inference from scope — preserves "hard_constraint without validator = advisory"
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
