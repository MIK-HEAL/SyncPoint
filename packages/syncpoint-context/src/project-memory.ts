/**
 * Project Memory Layer — types for long-lived project knowledge.
 *
 * Three-tier memory model:
 *   1. Shared State   — task / checkpoint / handoff / contract / context_snapshot
 *   2. Project Memory — architecture, decisions, conventions, gotchas, file map
 *   3. Pinned Memory  — few mandatory rules injected into every context
 */

import { z } from "zod";
import { createHash } from "node:crypto";

// ── Enums ────────────────────────────────────────────

export enum ProjectMemoryScope {
  PROJECT = "project",
  DOMAIN = "domain",
  TASK = "task",
  FILE = "file",
}

export enum ProjectMemoryCategory {
  OVERVIEW = "overview",
  ARCHITECTURE = "architecture",
  DECISION = "decision",
  CONVENTION = "convention",
  RISK = "risk",
  GOTCHA = "gotcha",
  GLOSSARY = "glossary",
  FILE_MAP = "file-map",
  INTEGRATION = "integration",
}

export enum ProjectMemoryStatus {
  DRAFT = "draft",
  APPROVED = "approved",
  DEPRECATED = "deprecated",
}

export enum ProjectMemoryConfidence {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export enum ProjectMemorySourceType {
  HUMAN = "human",
  AGENT = "agent",
  CHECKPOINT = "checkpoint",
  HANDOFF = "handoff",
  DOC = "doc",
}

// ── V2 Enums ────────────────────────────────────────

export enum MemoryKind {
  FACT = "fact",
  SOFT_CONVENTION = "soft_convention",
  RISK = "risk",
  DO_NOT_TOUCH = "do_not_touch",
  HARD_CONSTRAINT = "hard_constraint",
  PROTOCOL_RULE = "protocol_rule",
}

export enum ProjectionTarget {
  CONTEXT_SNAPSHOT = "context_snapshot",
  PROTOCOL_GATE = "protocol_gate",
  CONSTRAINT_RUNTIME = "constraint_runtime",
}

export enum MemorySeverity {
  INFO = "info",
  WARNING = "warning",
  BLOCKING = "blocking",
}

export enum ValidityStatus {
  FRESH = "fresh",
  NEEDS_REVALIDATION = "needs_revalidation",
  STALE = "stale",
  INVALID = "invalid",
}

// ── V2 Sub-schemas ──────────────────────────────────

export const AppliesToSchema = z.record(z.string(), z.array(z.string()));

export type AppliesTo = z.infer<typeof AppliesToSchema>;

export const ValiditySchema = z.object({
  status: z.nativeEnum(ValidityStatus).default(ValidityStatus.FRESH),
  staleReason: z.string().optional(),
});

export type Validity = z.infer<typeof ValiditySchema>;

export const ProjectMemoryValidatorConfigSchema = z.object({
  message: z.string().optional(),
  actions: z.array(z.string()).optional(),
}).catchall(z.unknown());

export type ProjectMemoryValidatorConfig = z.infer<typeof ProjectMemoryValidatorConfigSchema>;

/**
 * Default kind inference from category when kind is not explicitly set.
 */
export function defaultKindFromCategory(category: string): MemoryKind {
  switch (category) {
    case "risk":
      return MemoryKind.RISK;
    case "convention":
      return MemoryKind.SOFT_CONVENTION;
    case "gotcha":
      return MemoryKind.DO_NOT_TOUCH;
    default:
      return MemoryKind.FACT;
  }
}

/**
 * Valid projection targets for a given memory kind.
 * hard_constraint and protocol_rule MUST NOT project to context_snapshot only.
 */
export function validProjectionTargets(kind: MemoryKind): ProjectionTarget[] {
  switch (kind) {
    case MemoryKind.HARD_CONSTRAINT:
    case MemoryKind.PROTOCOL_RULE:
      return [ProjectionTarget.PROTOCOL_GATE, ProjectionTarget.CONSTRAINT_RUNTIME];
    case MemoryKind.DO_NOT_TOUCH:
      return [ProjectionTarget.CONTEXT_SNAPSHOT, ProjectionTarget.PROTOCOL_GATE, ProjectionTarget.CONSTRAINT_RUNTIME];
    default:
      return [ProjectionTarget.CONTEXT_SNAPSHOT, ProjectionTarget.PROTOCOL_GATE, ProjectionTarget.CONSTRAINT_RUNTIME];
  }
}

/**
 * Check if a projection target is valid for a memory kind.
 */
export function isValidProjection(kind: MemoryKind, target: ProjectionTarget): boolean {
  return validProjectionTargets(kind).includes(target);
}

// ── Fingerprint ─────────────────────────────────────

/**
 * Compute a content fingerprint for dedup detection.
 * Normalizes: lowercase, collapse whitespace, strip leading/trailing.
 * Hash input: `category|normalized_title|normalized_content`
 */
export function computeMemoryFingerprint(
  category: string,
  title: string,
  content: string,
): string {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const input = `${normalize(category)}|${normalize(title)}|${normalize(content)}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Check if two memories are content-duplicates (same fingerprint).
 */
export function isMemoryDuplicate(
  a: { category: string; title: string; content: string },
  b: { category: string; title: string; content: string },
): boolean {
  return computeMemoryFingerprint(a.category, a.title, a.content)
    === computeMemoryFingerprint(b.category, b.title, b.content);
}

// ── Schemas ──────────────────────────────────────────

/**
 * Canonical ProjectMemory schema — flat schema with both V1 and V2 fields.
 * V2 fields have sensible defaults for backward compatibility with V1 records.
 *
 * Schema versioning:
 *   - schemaVersion 1: V2 fields are present but at defaults (legacy records)
 *   - schemaVersion 2: V2 fields carry meaningful values (new records)
 *
 * The `schemaVersion` discriminant field enables type narrowing via isV1()/isV2().
 * For strict V1/V2 validation, use ProjectMemoryV1Schema / ProjectMemoryV2Schema.
 */
export const ProjectMemorySchema = z.object({
  id: z.string().min(1),
  scope: z.nativeEnum(ProjectMemoryScope),
  category: z.nativeEnum(ProjectMemoryCategory),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  sourceType: z.nativeEnum(ProjectMemorySourceType).default(ProjectMemorySourceType.HUMAN),
  sourceRef: z.string().default(""),
  status: z.nativeEnum(ProjectMemoryStatus).default(ProjectMemoryStatus.DRAFT),
  confidence: z.nativeEnum(ProjectMemoryConfidence).default(ProjectMemoryConfidence.MEDIUM),
  taskId: z.string().nullable().default(null),
  fingerprint: z.string().default(""),
  supersedes: z.string().nullable().default(null),
  supersededBy: z.string().nullable().default(null),
  // Schema version discriminant (added for V1/V2 separation)
  schemaVersion: z.number().int().min(1).max(2).default(1),
  // V2 fields (all have defaults for backward compat with V1 records)
  kind: z.nativeEnum(MemoryKind).default(MemoryKind.FACT),
  projectionTarget: z.nativeEnum(ProjectionTarget).nullable().default(null),
  appliesTo: AppliesToSchema.default({}),
  severity: z.nativeEnum(MemorySeverity).default(MemorySeverity.INFO),
  validityStatus: z.nativeEnum(ValidityStatus).default(ValidityStatus.FRESH),
  validityStaleReason: z.string().default(""),
  // PR4 typed constraint validator
  validatorType: z.string().default(""),
  validatorConfig: ProjectMemoryValidatorConfigSchema.nullable().default(null),
  createdBy: z.string().default(""),
  updatedBy: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;

/**
 * V1 narrowed type — legacy ProjectMemory with schemaVersion 1.
 * V2 fields are at their defaults (not explicitly set).
 */
export interface ProjectMemoryV1 extends ProjectMemory {
  schemaVersion: 1;
  kind: MemoryKind.FACT;
  severity: MemorySeverity.INFO;
  validityStatus: ValidityStatus.FRESH;
}

/**
 * V2 narrowed type — ProjectMemory with explicit V2 classification.
 * schemaVersion is 2 and V2 required fields carry meaningful values.
 */
export interface ProjectMemoryV2 extends ProjectMemory {
  schemaVersion: 2;
  kind: MemoryKind;
  severity: MemorySeverity;
  validityStatus: ValidityStatus;
}

/** V1-specific schema — schemaVersion locked to 1, V2 fields at defaults. */
export const ProjectMemoryV1Schema = ProjectMemorySchema.extend({
  schemaVersion: z.literal(1),
});

/** V2-specific schema — schemaVersion locked to 2, V2 fields required. */
export const ProjectMemoryV2Schema = ProjectMemorySchema.extend({
  schemaVersion: z.literal(2),
  kind: z.nativeEnum(MemoryKind),
  severity: z.nativeEnum(MemorySeverity),
  validityStatus: z.nativeEnum(ValidityStatus),
});

export const ProjectMemoryCreateSchema = z.object({
  scope: z.nativeEnum(ProjectMemoryScope).default(ProjectMemoryScope.PROJECT),
  category: z.nativeEnum(ProjectMemoryCategory),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  sourceType: z.nativeEnum(ProjectMemorySourceType).default(ProjectMemorySourceType.HUMAN),
  sourceRef: z.string().default(""),
  confidence: z.nativeEnum(ProjectMemoryConfidence).default(ProjectMemoryConfidence.MEDIUM),
  taskId: z.string().nullable().default(null),
  createdBy: z.string().default(""),
  // V2 optional fields
  kind: z.nativeEnum(MemoryKind).optional(),
  projectionTarget: z.nativeEnum(ProjectionTarget).nullable().optional(),
  appliesTo: AppliesToSchema.optional(),
  severity: z.nativeEnum(MemorySeverity).optional(),
  validity: ValiditySchema.optional(),
  // PR4 typed constraint validator
  validatorType: z.string().optional(),
  validatorConfig: ProjectMemoryValidatorConfigSchema.nullable().optional(),
});

export type ProjectMemoryCreate = z.infer<typeof ProjectMemoryCreateSchema>;

// ── V1 → V2 Migration ───────────────────────────────

/**
 * Upgrade a V1 memory to V2 format.
 * Infers V2 fields from existing V1 data where possible,
 * applies sensible defaults where inference isn't possible.
 */
export function upgradeV1ToV2(memory: ProjectMemoryV1): ProjectMemoryV2 {
  return {
    ...memory,
    schemaVersion: 2 as const,
    kind: defaultKindFromCategory(memory.category),
    projectionTarget: null,
    appliesTo: {},
    severity: MemorySeverity.INFO,
    validityStatus: ValidityStatus.FRESH,
    validityStaleReason: "",
    validatorType: "",
    validatorConfig: null,
  };
}

/**
 * Check if a memory is V2 (has explicit V2 classification fields).
 * Heuristic: V2 memories have a non-default kind OR explicit severity.
 */
export function isV2(memory: ProjectMemory): memory is ProjectMemoryV2 {
  return memory.schemaVersion === 2;
}

/**
 * Check if a memory is V1 (legacy, no explicit V2 classification).
 */
export function isV1(memory: ProjectMemory): memory is ProjectMemoryV1 {
  return !isV2(memory);
}

// ── Dedup result ────────────────────────────────────

export interface MemoryDedupResult {
  /** Is this a duplicate of an existing memory? */
  isDuplicate: boolean;
  /** ID of the existing duplicate (if found) */
  existingId?: string;
  /** Computed fingerprint */
  fingerprint: string;
}
