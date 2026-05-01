/**
 * P3A — Read-only Projection Compiler (Reality Compiler).
 *
 * Pure functions that compile CollectedMemory[] into a ProjectedReality.
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

// ── V2 kind/validity enums (re-export not needed, just reference values) ──

// ── Types ────────────────────────────────────────────────

/** Source trace for a single projected item. */
export interface ProjectionSource {
  sourceMemoryId: string;
  projectionReason: string;
  confidence: string;
}

/** Structured scope for runtime constraint evaluation. */
export interface ProjectionScope {
  files?: string[];
  modules?: string[];
  taskTypes?: string[];
}

/** A single projected item in one of the reality buckets. */
export interface ProjectionItem {
  source: ProjectionSource;
  content: string;
  title: string;
  /** Structured scope parsed from appliesTo — used by P4 Constraint Runtime. */
  scope?: ProjectionScope;
}

/** A detected conflict between projected items. */
export interface ProjectionConflict {
  kind: "contradicting_facts" | "overlapping_constraints" | "file_scope_collision";
  itemA: ProjectionSource;
  itemB: ProjectionSource;
  description: string;
}

/** Capsule-shaped patch produced by projection. */
export interface CapsulePatch {
  verifiedFacts: ProjectionItem[];
  activeConstraints: ProjectionItem[];
  risks: ProjectionItem[];
  doNotTouch: ProjectionItem[];
}

/** Audit trail: what produced this projection. */
export interface ProjectionCreatedFrom {
  taskId: string;
  capsuleId?: string;
  checkpointId?: string;
  contractId?: string;
  memoryVersion: number;
  generatedAt: string;
}

export type ProjectionValidityStatus = "fresh" | "needs_revalidation" | "stale" | "invalid";

/** The compiled reality snapshot. Read-only, never mutates state. */
export interface ProjectedReality {
  projectionId: string;
  createdFrom: ProjectionCreatedFrom;
  cacheKey: string;
  capsulePatch: CapsulePatch;
  protocolRules: ProjectionItem[];
  constraintRules: ProjectionItem[];
  conflicts: ProjectionConflict[];
  projectionValidity: ProjectionValidityStatus;
  /** Memories that were skipped due to invalid/stale validity */
  skippedStale: ProjectionSource[];
}

// ── Input shape (matches server CollectedMemory) ─────────

export interface ProjectionInput {
  id: string;
  category: string;
  title: string;
  content: string;
  fingerprint: string;
  kind: string;
  projectionTarget: string | null;
  appliesTo: string;   // JSON-serialized or ""
  severity: string;
  validityStatus: string;
}

/** Context for the projection compiler. */
export interface ProjectionContext {
  taskId: string;
  memoryVersion: number;
  /** Files currently being worked on (for appliesTo matching) */
  workingFiles?: string[];
  /** Current module context (for appliesTo matching) */
  currentModules?: string[];
  /** Optional IDs for audit trail */
  capsuleId?: string;
  checkpointId?: string;
  contractId?: string;
}

// ── Cache key ────────────────────────────────────────────

/**
 * Compute a stable cache key for a projection.
 * Changes when any input changes, enabling cache invalidation in P3B.
 */
export function computeProjectionCacheKey(
  ctx: ProjectionContext,
  memoriesFingerprints: string[],
): string {
  const parts = [
    `mv:${ctx.memoryVersion}`,
    `task:${ctx.taskId}`,
    `wf:${(ctx.workingFiles ?? []).sort().join(",")}`,
    `cm:${(ctx.currentModules ?? []).sort().join(",")}`,
    `cap:${ctx.capsuleId ?? ""}`,
    `cp:${ctx.checkpointId ?? ""}`,
    `con:${ctx.contractId ?? ""}`,
    `mfp:${memoriesFingerprints.sort().join(",")}`,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

// ── appliesTo filter ─────────────────────────────────────

interface ParsedAppliesTo {
  files?: string[];
  modules?: string[];
  taskTypes?: string[];
}

function parseAppliesTo(raw: string): ParsedAppliesTo | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParsedAppliesTo;
  } catch {
    return null;
  }
}

/**
 * Check if a memory's appliesTo scope is relevant to the current context.
 * If appliesTo is empty/null, the memory is always relevant (project-wide).
 */
function isRelevantToContext(
  appliesTo: ParsedAppliesTo | null,
  workingFiles: string[],
  currentModules: string[],
): boolean {
  if (!appliesTo) return true; // no scope restriction → always relevant

  let hasScope = false;
  let matched = false;

  if (appliesTo.files && appliesTo.files.length > 0) {
    hasScope = true;
    // Simple prefix/glob matching: file pattern matches if any working file starts with it
    // or the pattern ends with /** and the working file is under that path
    for (const pattern of appliesTo.files) {
      const prefix = pattern.replace(/\*\*?\/?$/, "");
      if (workingFiles.some(wf => wf === pattern || wf.startsWith(prefix))) {
        matched = true;
        break;
      }
    }
  }

  if (appliesTo.modules && appliesTo.modules.length > 0) {
    hasScope = true;
    for (const mod of appliesTo.modules) {
      if (currentModules.some(cm => cm === mod || cm.startsWith(mod + "/"))) {
        matched = true;
        break;
      }
    }
  }

  // If appliesTo had scope restrictions but nothing matched, it's not relevant
  if (hasScope && !matched) return false;
  return true;
}

// ── Conflict detection ───────────────────────────────────

/**
 * Detect conflicts between projected items.
 * Simple heuristic: two items in the same bucket with overlapping file scope.
 */
function detectConflicts(items: ProjectionItem[], parsedScopes: Map<string, ParsedAppliesTo | null>): ProjectionConflict[] {
  const conflicts: ProjectionConflict[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const scopeA = parsedScopes.get(a.source.sourceMemoryId);
      const scopeB = parsedScopes.get(b.source.sourceMemoryId);

      // File scope collision: both have file scopes that overlap
      if (scopeA?.files?.length && scopeB?.files?.length) {
        const filesA = new Set(scopeA.files.map(f => f.replace(/\*\*?\/?$/, "")));
        const overlap = scopeB.files.some(f => {
          const prefix = f.replace(/\*\*?\/?$/, "");
          return filesA.has(prefix) || [...filesA].some(a => prefix.startsWith(a) || a.startsWith(prefix));
        });
        if (overlap) {
          conflicts.push({
            kind: "file_scope_collision",
            itemA: a.source,
            itemB: b.source,
            description: `File scope overlap between "${a.title}" and "${b.title}"`,
          });
        }
      }
    }
  }

  return conflicts;
}

// ── Kind → bucket mapping ────────────────────────────────

type BucketName = "verifiedFacts" | "activeConstraints" | "risks" | "doNotTouch" | "protocolRules" | "constraintRules";

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

function projectionReasonForKind(kind: string): string {
  switch (kind) {
    case "fact":             return "fact → capsulePatch.verifiedFacts";
    case "soft_convention":  return "soft_convention → capsulePatch.activeConstraints";
    case "risk":             return "risk → capsulePatch.risks";
    case "do_not_touch":     return "do_not_touch → capsulePatch.doNotTouch";
    case "hard_constraint":  return "hard_constraint → constraintRules";
    case "protocol_rule":    return "protocol_rule → protocolRules";
    default:                 return `${kind} → verifiedFacts (fallback)`;
  }
}

// ── Compiler ─────────────────────────────────────────────

/**
 * Compile a set of collected memories into a ProjectedReality.
 * Pure function — no I/O, no side effects, deterministic.
 */
export function compileProjection(
  memories: ProjectionInput[],
  ctx: ProjectionContext,
): ProjectedReality {
  const now = new Date().toISOString();
  const workingFiles = ctx.workingFiles ?? [];
  const currentModules = ctx.currentModules ?? [];

  // Buckets
  const verifiedFacts: ProjectionItem[] = [];
  const activeConstraints: ProjectionItem[] = [];
  const risks: ProjectionItem[] = [];
  const doNotTouch: ProjectionItem[] = [];
  const protocolRules: ProjectionItem[] = [];
  const constraintRules: ProjectionItem[] = [];
  const skippedStale: ProjectionSource[] = [];
  const allConflicts: ProjectionConflict[] = [];

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
    if (!isRelevantToContext(parsed, workingFiles, currentModules)) {
      continue; // not relevant to current task context
    }

    projectedFingerprints.push(mem.fingerprint);

    const item: ProjectionItem = {
      source,
      content: mem.content,
      title: mem.title,
      scope: parsed ? { files: parsed.files, modules: parsed.modules, taskTypes: parsed.taskTypes } : undefined,
    };

    // Map kind → bucket
    const bucket = kindToBucket(mem.kind);
    switch (bucket) {
      case "verifiedFacts":     verifiedFacts.push(item); break;
      case "activeConstraints": activeConstraints.push(item); break;
      case "risks":             risks.push(item); break;
      case "doNotTouch":
        doNotTouch.push(item);
        // P4A: dual-write — do_not_touch also enters constraintRules for runtime enforcement
        constraintRules.push({
          ...item,
          source: { ...source, projectionReason: "do_not_touch → constraintRules (P4 enforcement)" },
        });
        break;
      case "protocolRules":     protocolRules.push(item); break;
      case "constraintRules":   constraintRules.push(item); break;
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
      capsuleId: ctx.capsuleId,
      checkpointId: ctx.checkpointId,
      contractId: ctx.contractId,
      memoryVersion: ctx.memoryVersion,
      generatedAt: now,
    },
    cacheKey,
    capsulePatch: {
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
