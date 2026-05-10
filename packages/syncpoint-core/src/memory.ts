/**
 * Memory Switch Engine — types and quality checks.
 *
 * Defines the resume context structure, pinned memory,
 * quality check results, and context policy enforcement.
 */

import { z } from "zod";

// ── Pinned Memory ─────────────────────────────────────

export const PinnedMemorySchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  content: z.string().min(1),
  scope: z.enum(["global", "project", "task"]).default("project"),
  taskId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PinnedMemory = z.infer<typeof PinnedMemorySchema>;

export const PinnedMemoryCreateSchema = z.object({
  key: z.string().min(1),
  content: z.string().min(1),
  scope: z.enum(["global", "project", "task"]).default("project"),
  taskId: z.string().nullable().default(null),
});

export type PinnedMemoryCreate = z.infer<typeof PinnedMemoryCreateSchema>;

// ── Quality Check ─────────────────────────────────────

export enum QualityCheckStatus {
  PASS = "PASS",
  WARN = "WARN",
  FAIL = "FAIL",
}

export const QualityCheckResultSchema = z.object({
  name: z.string(),
  status: z.nativeEnum(QualityCheckStatus),
  message: z.string(),
});

export type QualityCheckResult = z.infer<typeof QualityCheckResultSchema>;

// ── Resume Context ────────────────────────────────────

export const ResumeContextSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  /** Overall readiness: true = safe to resume, false = action needed */
  ready: z.boolean(),
  /** Quality checks that were run */
  checks: z.array(QualityCheckResultSchema),
  /** Task metadata */
  task: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    ownerAgentId: z.string().nullable(),
  }),
  /** Current agent info */
  agent: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
  }),
  /** Approved peer contract summary (null if none) */
  approvedContract: z.object({
    id: z.string(),
    title: z.string(),
    scope: z.string(),
    responsibilities: z.string(),
    interfaceSpec: z.string(),
    fileBoundaries: z.string(),
    status: z.string(),
  }).nullable(),
  /** Latest context snapshot (null if none) */
  latestSnapshot: z.object({
    id: z.string(),
    kind: z.string().default("resume"),
    summary: z.string().default(""),
    payloadJson: z.string().default("{}"),
    createdAt: z.string(),
  }).nullable(),
  /** Latest checkpoint (null if none) */
  latestCheckpoint: z.object({
    id: z.string(),
    summary: z.string(),
    progress: z.string(),
    risks: z.string(),
    blockers: z.string(),
    nextSteps: z.string(),
    needSync: z.boolean(),
    createdAt: z.string(),
  }).nullable(),
  /** Pinned memories relevant to this context */
  pinnedMemories: z.array(z.object({
    key: z.string(),
    content: z.string(),
  })),
  /** Project memories (approved knowledge) injected into context */
  projectMemories: z.array(z.object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    content: z.string(),
  })).default([]),
  /** Generated resume prompt text */
  resumePrompt: z.string(),
  /** Warnings or required actions before resume */
  warnings: z.array(z.string()),
  /** P12: Context mode used for this resume */
  contextMode: z.string().default("snapshot-first"),
  generatedAt: z.string(),
});

export type ResumeContext = z.infer<typeof ResumeContextSchema>;
