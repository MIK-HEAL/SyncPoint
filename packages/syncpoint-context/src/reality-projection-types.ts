/** Shared types and cache-key helpers for reality projections. */

import { createHash } from "node:crypto";
import type { ResourceRef } from "syncpoint-kernel";

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
