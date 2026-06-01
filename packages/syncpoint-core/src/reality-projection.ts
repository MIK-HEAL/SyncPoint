/**
 * Reality Projection — task-scoped memory view builder.
 *
 * Pure functions that build a RealityProjection from collected project memories.
 * No I/O, no DB, no side effects.
 *
 * Five principles:
 *   1. Minimal Reality       — only project memories relevant to current task
 *   2. Traceable Reality     — every item has sourceMemoryId + projectionReason
 *   3. Explicit Conflict     — conflicts are surfaced, never silently resolved
 *   4. Auditable Projection  — projectionId + createdFrom for audit trail
 *   5. Reality Freshness     — stale/invalid memories gated from fresh projection
 */

import { createHash } from "node:crypto";
import type { ResourceRef } from "./resource.js";

// ── V2 kind/validity enums (re-export not needed, just reference values) ──

// ── Types ────────────────────────────────────────────────

/** Source trace for a single projected item. */
export interface ProjectionSource {
  sourceMemoryId: string;
  projectionReason: string;
  confidence: string;
}

/**
 * Structured scope for runtime constraint evaluation.
 * Keys are scope field names (e.g. "files", "modules", "resources");
 * values are pattern arrays. Plugins register ScopeMatchers for
 * their fields — core never interprets field names directly.
 */
export interface ProjectionScope {
  [key: string]: string[] | undefined;
}

// ── Pluggable Scope Matcher ─────────────────────────────

/**
 * A ScopeMatcher handles scope matching for a specific scope field
 * (e.g. "files", "modules"). Plugins register matchers so core never
 * needs domain-specific matching logic like glob or prefix overlap.
 */
export interface ScopeMatcher {
  /** The scope field name this matcher handles (e.g. "files"). */
  field: string;
  /**
   * Optional resource type filter. When set, scope overlap checks will
   * pre-filter touched resources to only those whose `type` matches one
   * of the declared types. This prevents cross-domain false positives
   * (e.g. a binary_asset locator matching a `files` scope pattern).
   *
   * If undefined or empty, all resource types are considered.
   */
  resourceTypes?: string[];
  /**
   * Return the subset of `targets` that match any of `patterns`.
   * An empty result means no overlap.
   */
  findOverlaps(patterns: string[], targets: string[]): string[];
}

const _scopeMatchers = new Map<string, ScopeMatcher>();

export function registerScopeMatcher(m: ScopeMatcher): void {
  _scopeMatchers.set(m.field, m);
}

export function getScopeMatcher(field: string): ScopeMatcher | undefined {
  return _scopeMatchers.get(field);
}

export function clearScopeMatcherRegistry(): void {
  _scopeMatchers.clear();
}

/** Default exact-match overlap: pattern matches target if they're identical. */
function defaultFindOverlaps(patterns: string[], targets: string[]): string[] {
  const pSet = new Set(patterns);
  return targets.filter(t => pSet.has(t));
}

/** A single projected item in one of the reality buckets. */
export interface ProjectedMemoryItem {
  source: ProjectionSource;
  content: string;
  title: string;
  /** Original memory kind — used by Constraint Evaluation for structural identification. */
  kind?: string;
  /** Structured scope parsed from appliesTo — used by Constraint Evaluation. */
  scope?: ProjectionScope;
  /** PR4: Typed validator type (e.g. "resource_forbidden", "require_review"). */
  validatorType?: string;
  /** PR4: Typed validator config. */
  validatorConfig?: { message?: string; actions?: string[] } | string | null;
}

/** A detected conflict between projected items. */
export interface RealityProjectionConflict {
  kind: "contradicting_facts" | "overlapping_constraints" | "scope_collision";
  itemA: ProjectionSource;
  itemB: ProjectionSource;
  description: string;
}

/** Context patch produced by projection. */
export interface ContextPatch {
  verifiedFacts: ProjectedMemoryItem[];
  activeConstraints: ProjectedMemoryItem[];
  risks: ProjectedMemoryItem[];
  doNotTouch: ProjectedMemoryItem[];
}

/** Audit trail: what produced this projection. */
export interface ProjectionCreatedFrom {
  taskId: string;
  snapshotId?: string;
  checkpointId?: string;
  contractId?: string;
  memoryVersion: number;
  generatedAt: string;
}

export type ProjectionValidityStatus = "fresh" | "needs_revalidation" | "stale" | "invalid";

/** The compiled reality snapshot. Read-only, never mutates state. */
export interface RealityProjection {
  projectionId: string;
  createdFrom: ProjectionCreatedFrom;
  cacheKey: string;
  contextPatch: ContextPatch;
  protocolRules: ProjectedMemoryItem[];
  constraintRules: ProjectedMemoryItem[];
  conflicts: RealityProjectionConflict[];
  projectionValidity: ProjectionValidityStatus;
  /** Memories that were skipped due to invalid/stale validity */
  skippedStale: ProjectionSource[];
}

// ── Input shape (matches server CollectedMemory) ─────────

export interface MemoryProjectionInput {
  id: string;
  category: string;
  title: string;
  content: string;
  fingerprint: string;
  kind: string;
  projectionTarget: string | null;
  appliesTo: ProjectionScope | string;
  severity: string;
  validityStatus: string;
  // PR4 typed constraint validator
  validatorType?: string;
  validatorConfig?: { message?: string; actions?: string[] } | string | null;
}

/** Context for the projection compiler. */
export interface ProjectionContext {
  taskId: string;
  memoryVersion: number;
  /** Resource locators currently being worked on (for appliesTo matching) */
  workingResources?: string[];
  /**
   * Typed resource refs for resource-type-aware appliesTo filtering.
   * When provided, scope matchers with `resourceTypes` will only see
   * locators from matching resource types, reducing context noise.
   * Falls back to `workingResources` (all locators) if not provided.
   */
  workingResourceRefs?: ResourceRef[];
  /** Current module context (for appliesTo matching) */
  currentModules?: string[];
  /** Optional IDs for audit trail (createdFrom only, NOT used in cache key) */
  snapshotId?: string;
  checkpointId?: string;
  contractId?: string;
  /** Content hashes — used in cache key instead of IDs */
  snapshotHash?: string;
  checkpointHash?: string;
  contractHash?: string;
}

// ── Content hash utility ─────────────────────────────────

/**
 * Compute a short content hash from one or more string fields.
 * Used to derive snapshotHash / checkpointHash / contractHash
 * from entity content rather than IDs.
 */
export function computeContentHash(...fields: string[]): string {
  return createHash("sha256").update(fields.join("|")).digest("hex").slice(0, 16);
}

// ── Cache key ────────────────────────────────────────────

/**
 * Compute a stable cache key for a projection.
 * Uses content hashes (not IDs) so that same-content-different-ID → same key.
 * IDs are only stored in createdFrom for audit trail.
 * Includes memoryVersion — used as the projection's own identity key.
 */
export function computeProjectionCacheKey(
  ctx: ProjectionContext,
  memoriesFingerprints: string[],
): string {
  const parts = [
    `mv:${ctx.memoryVersion}`,
    ...lookupKeyParts(ctx, memoriesFingerprints),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Compute a lookup key for the projection cache.
 * Same as cacheKey but WITHOUT memoryVersion, so that a version bump
 * produces the same lookup key and enables lazy invalidation on read.
 */
export function computeProjectionLookupKey(
  ctx: ProjectionContext,
  memoriesFingerprints: string[],
): string {
  const parts = lookupKeyParts(ctx, memoriesFingerprints);
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/** Shared key parts (everything except memoryVersion). */
function lookupKeyParts(ctx: ProjectionContext, memoriesFingerprints: string[]): string[] {
  return [
    `task:${ctx.taskId}`,
    `wr:${(ctx.workingResources ?? []).sort().join(",")}`,
    `cm:${(ctx.currentModules ?? []).sort().join(",")}`,
    `snph:${ctx.snapshotHash ?? ""}`,
    `cph:${ctx.checkpointHash ?? ""}`,
    `conh:${ctx.contractHash ?? ""}`,
    `mfp:${memoriesFingerprints.sort().join(",")}`,
  ];
}

// ── appliesTo filter ─────────────────────────────────────

interface ParsedAppliesTo {
  [key: string]: string[] | undefined;
}

function parseAppliesTo(raw: ProjectionScope | string | null | undefined): ParsedAppliesTo | null {
  if (!raw) return null;
  if (typeof raw !== "string") {
    return raw as ParsedAppliesTo;
  }
  try {
    return JSON.parse(raw) as ParsedAppliesTo;
  } catch {
    return null;
  }
}

/**
 * Context values for scope matching, keyed by scope field name.
 * Populated from ProjectionContext.workingResources, currentModules, etc.
 */
interface ScopeContextMap {
  [key: string]: string[];
}

function isRelevantToContext(
  appliesTo: ParsedAppliesTo | null,
  scopeContext: ScopeContextMap,
  resourceRefs?: ResourceRef[],
): boolean {
  if (!appliesTo) return true; // no scope restriction → always relevant

  let hasScope = false;
  let matched = false;

  // Check each scope field via registered matchers (or exact match fallback)
  for (const [field, patterns] of Object.entries(appliesTo)) {
    if (!patterns || !Array.isArray(patterns) || patterns.length === 0) continue;
    hasScope = true;
    const matcher = _scopeMatchers.get(field);
    // Resource-type-aware filtering: if resourceRefs available and matcher
    // declares resourceTypes, only use locators from matching types for
    // locator-backed fields. Independent context dimensions such as modules
    // should continue using their own scopeContext values.
    const contextTargets = scopeContext[field] ?? [];
    const allResourceLocators = resourceRefs
      ? new Set(resourceRefs.map(r => r.locator))
      : undefined;
    const isLocatorBackedField = contextTargets.length === 0
      || contextTargets.every(t => allResourceLocators?.has(t));
    let targets: string[];
    if (resourceRefs && matcher?.resourceTypes?.length && isLocatorBackedField) {
      targets = resourceRefs
        .filter(r => matcher.resourceTypes!.includes(r.type))
        .map(r => r.locator);
    } else {
      targets = contextTargets;
    }
    if (targets.length === 0) continue;
    const overlaps = matcher
      ? matcher.findOverlaps(patterns, targets)
      : defaultFindOverlaps(patterns, targets);
    if (overlaps.length > 0) {
      matched = true;
      break;
    }
  }

  // If appliesTo had scope restrictions but nothing matched, it's not relevant
  if (hasScope && !matched) return false;
  return true;
}

// ── Conflict detection ───────────────────────────────────

/**
 * Detect conflicts between projected items.
 * Heuristic: two items in the same bucket with overlapping scope on any field.
 */
function detectConflicts(items: ProjectedMemoryItem[], parsedScopes: Map<string, ParsedAppliesTo | null>): RealityProjectionConflict[] {
  const conflicts: RealityProjectionConflict[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const scopeA = parsedScopes.get(a.source.sourceMemoryId);
      const scopeB = parsedScopes.get(b.source.sourceMemoryId);
      if (!scopeA || !scopeB) continue;

      // Check every scope field for overlap
      for (const field of Object.keys(scopeA)) {
        const patternsA = scopeA[field];
        const patternsB = scopeB[field];
        if (!patternsA?.length || !patternsB?.length) continue;

        const matcher = _scopeMatchers.get(field);
        const overlaps = matcher
          ? matcher.findOverlaps(patternsA, patternsB)
          : defaultFindOverlaps(patternsA, patternsB);
        if (overlaps.length > 0) {
          conflicts.push({
            kind: "scope_collision",
            itemA: a.source,
            itemB: b.source,
            description: `Scope overlap (${field}) between "${a.title}" and "${b.title}"`,
          });
          break; // one collision per pair is enough
        }
      }
    }
  }

  return conflicts;
}

// ── Kind → bucket mapping ────────────────────────────────

type BucketName = "verifiedFacts" | "activeConstraints" | "risks" | "doNotTouch" | "protocolRules" | "constraintRules";

/** Default kind→bucket mapping (used when projectionTarget is null). */
function kindToBucket(kind: string): BucketName {
  switch (kind) {
    case "fact":             return "verifiedFacts";
    case "soft_convention":  return "activeConstraints";
    case "risk":             return "risks";
    case "do_not_touch":     return "doNotTouch";
    case "hard_constraint":  return "constraintRules";
    case "protocol_rule":    return "protocolRules";
    default:                 return "verifiedFacts";
  }
}

/** Map projectionTarget value → bucket name. */
function targetToBucket(target: string): BucketName | null {
  switch (target) {
    case "context_snapshot":    return null; // context_snapshot routes by kind
    case "protocol_gate":       return "protocolRules";
    case "constraint_runtime":  return "constraintRules";
    default:                    return null;
  }
}

/** Map context-snapshot-targeted item to the appropriate sub-bucket by kind. */
function kindToSnapshotBucket(kind: string): BucketName {
  switch (kind) {
    case "fact":             return "verifiedFacts";
    case "soft_convention":  return "activeConstraints";
    case "risk":             return "risks";
    case "do_not_touch":     return "doNotTouch";
    case "hard_constraint":  return "verifiedFacts"; // fallback when explicitly context_snapshot-targeted
    case "protocol_rule":    return "verifiedFacts"; // fallback when explicitly context_snapshot-targeted
    default:                 return "verifiedFacts";
  }
}

export interface ProjectionRoute {
  buckets: BucketName[];
  reason: string;
}

/**
 * Resolve where a memory should be routed.
 * If projectionTarget is set, it overrides the default kindToBucket mapping.
 * Returns one or more buckets (multi-bucket routing when no explicit target).
 */
export function resolveProjectionRoute(kind: string, projectionTarget: string | null): ProjectionRoute {
  // Explicit target overrides default routing
  if (projectionTarget) {
    const bucket = targetToBucket(projectionTarget);
    if (bucket) {
      return {
        buckets: [bucket],
        reason: `${kind} → ${bucket} (explicit target: ${projectionTarget})`,
      };
    }
    // target === "context_snapshot" — route by kind to context snapshot sub-bucket
    if (projectionTarget === "context_snapshot") {
      const capBucket = kindToSnapshotBucket(kind);
      return {
        buckets: [capBucket],
        reason: `${kind} → ${capBucket} (explicit target: context_snapshot)`,
      };
    }
    // Unknown target — fall through to default
  }

  // Default routing by kind
  const defaultBucket = kindToBucket(kind);

  return {
    buckets: [defaultBucket],
    reason: projectionReasonForKind(kind),
  };
}

function projectionReasonForKind(kind: string): string {
  switch (kind) {
    case "fact":             return "fact → contextPatch.verifiedFacts";
    case "soft_convention":  return "soft_convention → contextPatch.activeConstraints";
    case "risk":             return "risk → contextPatch.risks";
    case "do_not_touch":     return "do_not_touch → contextPatch.doNotTouch";
    case "hard_constraint":  return "hard_constraint → constraintRules";
    case "protocol_rule":    return "protocol_rule → protocolRules";
    default:                 return `${kind} → verifiedFacts (fallback)`;
  }
}

// ── Compiler ─────────────────────────────────────────────

/**
 * Build a task-scoped view of relevant project memory.
 * Pure function — no I/O, no side effects, deterministic.
 */
export function buildRealityProjection(
  memories: MemoryProjectionInput[],
  ctx: ProjectionContext,
): RealityProjection {
  const now = new Date().toISOString();
  const workingResources = ctx.workingResources ?? [];
  const currentModules = ctx.currentModules ?? [];

  // Build scope context for appliesTo matching
  // "files" and "resources" both map to workingResources so that either
  // appliesTo field name can match. Plugins register ScopeMatchers for
  // their preferred field name (e.g. "resources" for generic-agent plugin).
  const scopeContext: ScopeContextMap = {
    files: workingResources,
    modules: currentModules,
    resources: workingResources,
  };

  // Buckets
  const verifiedFacts: ProjectedMemoryItem[] = [];
  const activeConstraints: ProjectedMemoryItem[] = [];
  const risks: ProjectedMemoryItem[] = [];
  const doNotTouch: ProjectedMemoryItem[] = [];
  const protocolRules: ProjectedMemoryItem[] = [];
  const constraintRules: ProjectedMemoryItem[] = [];
  const skippedStale: ProjectionSource[] = [];
  const allConflicts: RealityProjectionConflict[] = [];

  // Track parsed scopes for conflict detection
  const parsedScopes = new Map<string, ParsedAppliesTo | null>();
  // Track projected fingerprints
  const projectedFingerprints: string[] = [];
  // Overall validity
  let worstValidity: ProjectionValidityStatus = "fresh";

  for (const mem of memories) {
    const source: ProjectionSource = {
      sourceMemoryId: mem.id,
      projectionReason: projectionReasonForKind(mem.kind),
      confidence: mem.severity === "blocking" ? "high" : mem.severity === "warning" ? "medium" : "low",
    };

    // Principle 5: Reality Freshness — gate stale/invalid memories
    if (mem.validityStatus === "invalid") {
      skippedStale.push({ ...source, projectionReason: `skipped: validity=${mem.validityStatus}` });
      continue;
    }
    if (mem.validityStatus === "stale") {
      skippedStale.push({ ...source, projectionReason: `skipped: validity=${mem.validityStatus}` });
      continue;
    }
    if (mem.validityStatus === "needs_revalidation") {
      // Include but downgrade overall validity
      if (worstValidity === "fresh") worstValidity = "needs_revalidation";
    }

    // Principle 1: Minimal Reality — appliesTo filter
    const parsed = parseAppliesTo(mem.appliesTo);
    parsedScopes.set(mem.id, parsed);
    if (!isRelevantToContext(parsed, scopeContext, ctx.workingResourceRefs)) {
      continue; // not relevant to current task context
    }

    projectedFingerprints.push(mem.fingerprint);

    // Resolve routing: projectionTarget overrides default kind→bucket
    const route = resolveProjectionRoute(mem.kind, mem.projectionTarget);

    const item: ProjectedMemoryItem = {
      source: { ...source, projectionReason: route.reason },
      content: mem.content,
      title: mem.title,
      kind: mem.kind,
      scope: parsed ? { ...parsed } as ProjectionScope : undefined,
      validatorType: mem.validatorType || undefined,
      validatorConfig: mem.validatorConfig || undefined,
    };

    const bucketMap: Record<BucketName, ProjectedMemoryItem[]> = {
      verifiedFacts, activeConstraints, risks, doNotTouch, protocolRules, constraintRules,
    };

    let isFirst = true;
    for (const bucket of route.buckets) {
      if (isFirst) {
        bucketMap[bucket].push(item);
        isFirst = false;
      } else {
        // Subsequent buckets get a copy with adjusted reason (dual-write)
        bucketMap[bucket].push({
          ...item,
          source: { ...source, projectionReason: `${route.reason} (dual-write)` },
        });
      }
    }
  }

  // Principle 3: Explicit Conflict — detect within each bucket
  allConflicts.push(...detectConflicts(constraintRules, parsedScopes));
  allConflicts.push(...detectConflicts(protocolRules, parsedScopes));
  allConflicts.push(...detectConflicts(doNotTouch, parsedScopes));

  // If there are conflicts, degrade validity
  if (allConflicts.length > 0 && worstValidity === "fresh") {
    worstValidity = "needs_revalidation";
  }

  const cacheKey = computeProjectionCacheKey(ctx, projectedFingerprints);

  // Generate projection ID
  const projectionId = createHash("sha256")
    .update(`${cacheKey}|${now}`)
    .digest("hex")
    .slice(0, 16);

  return {
    projectionId,
    createdFrom: {
      taskId: ctx.taskId,
      snapshotId: ctx.snapshotId,
      checkpointId: ctx.checkpointId,
      contractId: ctx.contractId,
      memoryVersion: ctx.memoryVersion,
      generatedAt: now,
    },
    cacheKey,
    contextPatch: {
      verifiedFacts,
      activeConstraints,
      risks,
      doNotTouch,
    },
    protocolRules,
    constraintRules,
    conflicts: allConflicts,
    projectionValidity: worstValidity,
    skippedStale,
  };
}
