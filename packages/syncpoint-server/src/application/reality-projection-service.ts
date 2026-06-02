/**
 * P3A — Projection Service (server-side orchestrator).
 *
 * Bridges collectProjectMemories → compileProjection.
 * Read-only: never mutates snapshot, checkpoint, or contract.
 *
 * PR3: In-memory read-through projection cache.
 * Lookup key excludes memoryVersion → lazy invalidation on version bump.
 * Fingerprints are pre-filtered (skip stale/invalid) to match compiler behavior.
 */

import {
  buildRealityProjection,
  computeProjectionLookupKey,
  normalizeResourcePath,
  type RealityProjection,
  type ProjectionContext,
  type MemoryProjectionInput,
} from "syncpoint-core";
import {
  collectProjectMemories,
  getMemoryVersion,
} from "../repositories/_exports/context-memory.js";
import "./_scope-matchers.js";
import { getProjectRoot } from "./path-resolver.js";

// ── Projection Cache ──────────────────────────────────────

interface CacheEntry {
  projection: RealityProjection;
  memoryVersion: number;
  lastAccessedAt: number;
}

const DEFAULT_MAX_CACHE_SIZE = 64;

let _cache = new Map<string, CacheEntry>();
let _maxCacheSize = DEFAULT_MAX_CACHE_SIZE;
let _stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };

/** Evict least-recently-accessed entries when cache exceeds max size. */
function evictIfNeeded(): void {
  while (_cache.size > _maxCacheSize) {
    // Map iterates in insertion order; find the entry with oldest lastAccessedAt
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of _cache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      _cache.delete(oldestKey);
      _stats.evictions++;
    } else {
      break;
    }
  }
}

export interface ProjectionCacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
}

/** Get projection cache statistics. */
export function getProjectionCacheStats(): ProjectionCacheStats {
  return {
    size: _cache.size,
    maxSize: _maxCacheSize,
    ..._stats,
  };
}

/** Clear the projection cache. */
export function clearProjectionCache(): void {
  _cache = new Map();
  _stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
}

/** Set the maximum cache size. */
export function setProjectionCacheMaxSize(max: number): void {
  _maxCacheSize = max;
  evictIfNeeded();
}

// ── Build Projection (with cache) ─────────────────────────

/**
 * Build a projected reality for a given task.
 * Orchestrates: collect canonical memories → compile projection.
 *
 * Uses an in-memory read-through cache:
 *   1. Collect memories, pre-filter stale/invalid, compute lookupKey (no memoryVersion)
 *   2. If cache has entry with matching lookupKey AND same memoryVersion → hit
 *   3. If lookupKey exists but memoryVersion differs → lazy invalidation
 *   4. Otherwise compile, store under lookupKey, and return
 */
export function buildProjection(ctx: Omit<ProjectionContext, "memoryVersion">): RealityProjection {
  const memoryVersion = getMemoryVersion();
  const collected = collectProjectMemories(ctx.taskId);

  // Normalize workingResources to absolute paths so they match
  // normalized appliesTo scope patterns during projection building
  const root = getProjectRoot();
  const normalizedCtx = {
    ...ctx,
    workingResources: ctx.workingResources?.map(r => normalizeResourcePath(r, { projectRoot: root })),
    workingResourceRefs: ctx.workingResourceRefs?.map(r => ({
      ...r,
      locator: r.type === "file" ? normalizeResourcePath(r.locator, { projectRoot: root }) : r.locator,
    })),
  };

  // CollectedMemory extends ProjectionInput — direct assignment, no mapping needed
  const inputs: MemoryProjectionInput[] = collected;

  // Pre-filter: skip stale/invalid inputs before computing lookup key
  // This matches the compiler's filtering, ensuring lookup key consistency
  // with the returned projection.cacheKey.
  const relevantFingerprints = inputs
    .filter(m => m.validityStatus !== "invalid" && m.validityStatus !== "stale")
    .map(m => m.fingerprint)
    .filter(Boolean);

  const fullCtx: ProjectionContext = { ...normalizedCtx, memoryVersion };

  // Lookup key excludes memoryVersion → same key across version bumps
  const lookupKey = computeProjectionLookupKey(fullCtx, relevantFingerprints);

  // Cache lookup
  const cached = _cache.get(lookupKey);
  if (cached && cached.memoryVersion === memoryVersion) {
    cached.lastAccessedAt = Date.now();
    _stats.hits++;
    return cached.projection;
  }

  // Lazy invalidation: entry exists but memoryVersion changed
  if (cached) {
    _cache.delete(lookupKey);
    _stats.invalidations++;
  }

  // Cache miss — compile
  _stats.misses++;
  const projection = buildRealityProjection(inputs, fullCtx);

  // Store in cache under lookupKey
  _cache.set(lookupKey, {
    projection,
    memoryVersion,
    lastAccessedAt: Date.now(),
  });
  evictIfNeeded();

  return projection;
}
