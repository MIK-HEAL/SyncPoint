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
import type { ResourceRef } from "syncpoint-kernel";

// ── V2 kind/validity enums (re-export not needed, just reference values) ──

// ── Types ────────────────────────────────────────────────


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


import type {
  ProjectionSource, ProjectionScope, ScopeMatcher, ProjectedMemoryItem,
  RealityProjectionConflict, ProjectionValidityStatus, RealityProjection,
  MemoryProjectionInput, ProjectionContext,
} from "./reality-projection-types.js";
import { computeProjectionCacheKey } from "./reality-projection-types.js";
export {
  computeContentHash,
  computeProjectionCacheKey,
  computeProjectionLookupKey,
} from "./reality-projection-types.js";
export type {
  ProjectionSource,
  ProjectionScope,
  ScopeMatcher,
  ProjectedMemoryItem,
  RealityProjectionConflict,
  ContextPatch,
  ProjectionCreatedFrom,
  ProjectionValidityStatus,
  RealityProjection,
  MemoryProjectionInput,
  ProjectionContext,
} from "./reality-projection-types.js";

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
      const a = items[i]!;
      const b = items[j]!;
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


import { resolveProjectionRoute } from "./reality-projection-routing.js";
import type { BucketName } from "./reality-projection-routing.js";
export { resolveProjectionRoute } from "./reality-projection-routing.js";
export type { ProjectionRoute } from "./reality-projection-routing.js";

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
