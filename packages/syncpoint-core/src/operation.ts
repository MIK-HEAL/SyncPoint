/**
 * Operation — generic operation protocol.
 *
 * Supports any operation type (e.g. "code_patch", "image_edit", "video_cut").
 * Plugins define specific operation types and their validators.
 */

import { z } from "zod";
import type { ResourceRef } from "./resource.js";
import { ResourceRefSchema } from "./resource.js";

// ── Status ──────────────────────────────────────────

export enum OperationStatus {
  DRAFT = "DRAFT",
  SUBMITTED = "SUBMITTED",
  CONFLICTING = "CONFLICTING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  APPLIED = "APPLIED",
  CANCELLED = "CANCELLED",
}

// ── Transitions ─────────────────────────────────────

const OPERATION_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  [OperationStatus.DRAFT]: [OperationStatus.SUBMITTED, OperationStatus.CANCELLED],
  [OperationStatus.SUBMITTED]: [
    OperationStatus.APPROVED,
    OperationStatus.REJECTED,
    OperationStatus.CONFLICTING,
    OperationStatus.CANCELLED,
  ],
  [OperationStatus.CONFLICTING]: [
    OperationStatus.SUBMITTED,
    OperationStatus.CANCELLED,
  ],
  [OperationStatus.APPROVED]: [OperationStatus.APPLIED, OperationStatus.CANCELLED],
  [OperationStatus.REJECTED]: [OperationStatus.SUBMITTED, OperationStatus.CANCELLED],
  [OperationStatus.APPLIED]: [],
  [OperationStatus.CANCELLED]: [],
};

export function validateOperationTransition(
  from: OperationStatus,
  to: OperationStatus,
): boolean {
  return (OPERATION_TRANSITIONS[from] ?? []).includes(to);
}

// ── Schema ──────────────────────────────────────────

export const OperationSchema = z.object({
  id: z.string(),
  type: z.string().min(1),
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().default(""),
  title: z.string(),
  summary: z.string(),
  targetResources: z.array(ResourceRefSchema),
  payloadRef: z.string().default(""),
  status: z.nativeEnum(OperationStatus),
  checkResult: z.string().default(""),
  decisionSummary: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Operation = z.infer<typeof OperationSchema>;

export const OperationCreateSchema = z.object({
  type: z.string().min(1),
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  title: z.string().min(1),
  summary: z.string().default(""),
  targetResources: z.array(ResourceRefSchema).default([]),
  payloadRef: z.string().default(""),
});

export type OperationCreate = z.infer<typeof OperationCreateSchema>;

// ── Check result (generic) ──────────────────────────

export interface OperationCheckItem {
  check: string;
  passed: boolean;
  detail: string;
}

export interface OperationCheckResult {
  allPassed: boolean;
  items: OperationCheckItem[];
  targetResources: ResourceRef[];
  uncoveredResources: ResourceRef[];
  conflictingClaimIds: string[];
  constraintViolations?: Array<{
    rule: string;
    sourceMemoryId: string;
    projectionId: string;
    message: string;
    evidence?: string[];
  }>;
}

// ── Approval ────────────────────────────────────────

export interface OperationApproval {
  operationId: string;
  actorId: string;
  decision: "approved" | "rejected";
  summary: string;
}
