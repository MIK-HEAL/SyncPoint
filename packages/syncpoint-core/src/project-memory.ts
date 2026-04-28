/**
 * Project Memory Layer — types for long-lived project knowledge.
 *
 * Three-tier memory model:
 *   1. Shared State   — task / checkpoint / handoff / contract / capsule
 *   2. Project Memory — architecture, decisions, conventions, gotchas, file map
 *   3. Pinned Memory  — few mandatory rules injected into every context
 */

import { z } from "zod";

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

// ── Schemas ──────────────────────────────────────────

export const ProjectMemorySchema = z.object({
  id: z.string().min(1),
  scope: z.nativeEnum(ProjectMemoryScope),
  category: z.nativeEnum(ProjectMemoryCategory),
  title: z.string().min(1),
  content: z.string().min(1),
  tags: z.string().default(""),
  sourceType: z.nativeEnum(ProjectMemorySourceType).default(ProjectMemorySourceType.HUMAN),
  sourceRef: z.string().default(""),
  status: z.nativeEnum(ProjectMemoryStatus).default(ProjectMemoryStatus.DRAFT),
  confidence: z.nativeEnum(ProjectMemoryConfidence).default(ProjectMemoryConfidence.MEDIUM),
  taskId: z.string().nullable().default(null),
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
  tags: z.string().default(""),
  sourceType: z.nativeEnum(ProjectMemorySourceType).default(ProjectMemorySourceType.HUMAN),
  sourceRef: z.string().default(""),
  confidence: z.nativeEnum(ProjectMemoryConfidence).default(ProjectMemoryConfidence.MEDIUM),
  taskId: z.string().nullable().default(null),
  createdBy: z.string().default(""),
});

export type ProjectMemoryCreate = z.infer<typeof ProjectMemoryCreateSchema>;
