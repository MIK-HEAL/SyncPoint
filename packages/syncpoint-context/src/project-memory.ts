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
  // V2 fields
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

// ── Dedup result ────────────────────────────────────

export interface MemoryDedupResult {
  /** Is this a duplicate of an existing memory? */
  isDuplicate: boolean;
  /** ID of the existing duplicate (if found) */
  existingId?: string;
  /** Computed fingerprint */
  fingerprint: string;
}
