/**
 * Review Workflow types — checklist, evidence, change requests, approval gates.
 * This is the protocol layer for v0.8 Review / Approval Workflow.
 * It builds on top of v0.7 orchestration (ReviewRequest / ReviewDecision)
 * and does NOT redefine context rules or Agent runtime.
 */

import { z } from "zod";
import {
  ApprovalGateStatus,
  ApprovalGateResultSchema,
  InvalidStateTransitionError,
} from "syncpoint-kernel";
import type { ApprovalGateResult } from "syncpoint-kernel";

// Re-export ApprovalGateResult types for backward compatibility
export { ApprovalGateResultSchema };
export type { ApprovalGateResult };

// ── Enums ────────────────────────────────────────────

export enum ChecklistItemStatus {
  OPEN = "OPEN",
  PASSED = "PASSED",
  FAILED = "FAILED",
  WAIVED = "WAIVED",
}

export const CHECKLIST_ITEM_TRANSITIONS: Record<ChecklistItemStatus, ChecklistItemStatus[]> = {
  [ChecklistItemStatus.OPEN]: [ChecklistItemStatus.PASSED, ChecklistItemStatus.FAILED, ChecklistItemStatus.WAIVED],
  [ChecklistItemStatus.PASSED]: [ChecklistItemStatus.OPEN],
  [ChecklistItemStatus.FAILED]: [ChecklistItemStatus.OPEN, ChecklistItemStatus.WAIVED],
  [ChecklistItemStatus.WAIVED]: [ChecklistItemStatus.OPEN],
};

export function validateChecklistItemTransition(current: ChecklistItemStatus, target: ChecklistItemStatus): void {
  const allowed = CHECKLIST_ITEM_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new InvalidStateTransitionError("ChecklistItem", current, target);
  }
}

export const EvidenceKind = z.enum([
  "build",
  "typecheck",
  "test",
  "lint",
  "manual",
  "diff",
  "log",
  "screenshot",
  "note",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export enum ChangeRequestStatus {
  OPEN = "OPEN",
  ADDRESSED = "ADDRESSED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
}

export const CHANGE_REQUEST_TRANSITIONS: Record<ChangeRequestStatus, ChangeRequestStatus[]> = {
  [ChangeRequestStatus.OPEN]: [ChangeRequestStatus.ADDRESSED, ChangeRequestStatus.REJECTED, ChangeRequestStatus.CANCELLED],
  [ChangeRequestStatus.ADDRESSED]: [ChangeRequestStatus.OPEN],
  [ChangeRequestStatus.REJECTED]: [],
  [ChangeRequestStatus.CANCELLED]: [],
};

export function validateChangeRequestTransition(current: ChangeRequestStatus, target: ChangeRequestStatus): void {
  const allowed = CHANGE_REQUEST_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    throw new InvalidStateTransitionError("ChangeRequest", current, target);
  }
}

// ApprovalGateStatus is imported from syncpoint-kernel (shared kernel type)
export { ApprovalGateStatus };

export const ApprovalRecordDecision = z.enum([
  "approved",
  "blocked",
  "waived",
]);
export type ApprovalRecordDecision = z.infer<typeof ApprovalRecordDecision>;

// ── Zod Schemas ──────────────────────────────────────

export const ReviewChecklistItemSchema = z.object({
  id: z.string(),
  reviewRequestId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  required: z.boolean().default(true),
  status: z.nativeEnum(ChecklistItemStatus).default(ChecklistItemStatus.OPEN),
  notes: z.string().default(""),
  updatedBy: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReviewChecklistItem = z.infer<typeof ReviewChecklistItemSchema>;

export const ReviewChecklistItemCreateSchema = z.object({
  reviewRequestId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});
export type ReviewChecklistItemCreate = z.infer<typeof ReviewChecklistItemCreateSchema>;

export const ReviewEvidenceSchema = z.object({
  id: z.string(),
  reviewRequestId: z.string(),
  kind: EvidenceKind,
  title: z.string(),
  content: z.string(),
  metadataJson: z.string().default(""),
  createdBy: z.string().default(""),
  createdAt: z.string(),
});
export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;

export const ReviewEvidenceCreateSchema = z.object({
  reviewRequestId: z.string(),
  kind: EvidenceKind,
  title: z.string(),
  content: z.string(),
  metadataJson: z.string().optional(),
  createdBy: z.string().optional(),
});
export type ReviewEvidenceCreate = z.infer<typeof ReviewEvidenceCreateSchema>;

export const ChangeRequestSchema = z.object({
  id: z.string(),
  reviewRequestId: z.string(),
  summary: z.string(),
  items: z.string().default(""),
  status: z.nativeEnum(ChangeRequestStatus).default(ChangeRequestStatus.OPEN),
  evidenceId: z.string().nullable().default(null),
  requestedBy: z.string().default(""),
  addressedBy: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

export const ChangeRequestCreateSchema = z.object({
  reviewRequestId: z.string(),
  summary: z.string(),
  items: z.string().optional(),
  requestedBy: z.string().optional(),
});
export type ChangeRequestCreate = z.infer<typeof ChangeRequestCreateSchema>;

export const ApprovalRecordSchema = z.object({
  id: z.string(),
  reviewRequestId: z.string(),
  decision: ApprovalRecordDecision,
  summary: z.string(),
  requestedChanges: z.string().default(""),
  waiverReason: z.string().default(""),
  decidedBy: z.string().default(""),
  createdAt: z.string(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const ApprovalRecordCreateSchema = z.object({
  reviewRequestId: z.string(),
  decision: ApprovalRecordDecision,
  summary: z.string(),
  requestedChanges: z.string().optional(),
  waiverReason: z.string().optional(),
  decidedBy: z.string().optional(),
});
export type ApprovalRecordCreate = z.infer<typeof ApprovalRecordCreateSchema>;

// ── Approval Gate (computed, not persisted) ──────────
// ApprovalGateResultSchema and ApprovalGateResult are now in syncpoint-kernel
// to break the governance ↔ adapters circular dependency.
// Re-exported at the top of this file for backward compatibility.

/**
 * Evaluate approval gate from checklist items, evidence, and change requests.
 * This is a pure computation — no DB access.
 */
export function evaluateApprovalGate(
  checklistItems: ReviewChecklistItem[],
  evidenceCount: number,
  openChangeRequestCount: number,
): ApprovalGateResult {
  const total = checklistItems.length;
  const passed = checklistItems.filter(i => i.status === ChecklistItemStatus.PASSED).length;
  const failed = checklistItems.filter(i => i.status === ChecklistItemStatus.FAILED).length;
  const waived = checklistItems.filter(i => i.status === ChecklistItemStatus.WAIVED).length;
  const open = checklistItems.filter(i => i.status === ChecklistItemStatus.OPEN).length;

  const reasons: string[] = [];

  // Required items that are FAILED
  const failedRequired = checklistItems.filter(
    i => i.required && i.status === ChecklistItemStatus.FAILED,
  );
  if (failedRequired.length > 0) {
    reasons.push(`${failedRequired.length} required checklist item(s) FAILED`);
  }

  // Required items still OPEN
  const openRequired = checklistItems.filter(
    i => i.required && i.status === ChecklistItemStatus.OPEN,
  );
  if (openRequired.length > 0) {
    reasons.push(`${openRequired.length} required checklist item(s) still OPEN`);
  }

  // No evidence
  if (evidenceCount === 0) {
    reasons.push("No review evidence recorded");
  }

  // Open change requests
  if (openChangeRequestCount > 0) {
    reasons.push(`${openChangeRequestCount} open change request(s)`);
  }

  // Determine status
  let status: ApprovalGateStatus;
  if (failedRequired.length > 0 || openRequired.length > 0 || evidenceCount === 0 || openChangeRequestCount > 0) {
    status = ApprovalGateStatus.BLOCKED;
  } else {
    status = ApprovalGateStatus.PASSED;
  }

  return {
    status,
    reasons,
    checklistTotal: total,
    checklistPassed: passed,
    checklistFailed: failed,
    checklistWaived: waived,
    checklistOpen: open,
    evidenceCount,
    openChangeRequests: openChangeRequestCount,
  };
}
