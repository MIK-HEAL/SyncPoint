/**
 * Review Workflow repository — checklist, evidence, change request, approval record CRUD.
 */

import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { ResourceNotFoundError } from "syncpoint-kernel";
import {
  ChecklistItemStatus,
  ChangeRequestStatus,
  validateChecklistItemTransition,
  validateChangeRequestTransition,
} from "syncpoint-governance";
import type {
  ReviewChecklistItem,
  ReviewChecklistItemCreate,
  ReviewEvidence,
  ReviewEvidenceCreate,
  ChangeRequest,
  ChangeRequestCreate,
  ApprovalRecord,
  ApprovalRecordCreate,
} from "syncpoint-governance";
import { _getDb, createId, now } from "./_shared.js";

// ── Checklist Items ──────────────────────────────────

export function createChecklistItem(input: ReviewChecklistItemCreate): ReviewChecklistItem {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.reviewChecklistItems).values({
    id,
    reviewRequestId: input.reviewRequestId,
    title: input.title,
    description: input.description ?? "",
    required: input.required ?? true,
    status: ChecklistItemStatus.OPEN,
    notes: "",
    updatedBy: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return db.select().from(s.reviewChecklistItems).where(eq(s.reviewChecklistItems.id, id)).get() as unknown as ReviewChecklistItem;
}

export function getChecklistItem(id: string): ReviewChecklistItem {
  const db = _getDb();
  const row = db.select().from(s.reviewChecklistItems).where(eq(s.reviewChecklistItems.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as ReviewChecklistItem;
}

export function listChecklistItems(reviewRequestId: string): ReviewChecklistItem[] {
  const db = _getDb();
  return db.select().from(s.reviewChecklistItems)
    .where(eq(s.reviewChecklistItems.reviewRequestId, reviewRequestId))
    .all() as unknown as ReviewChecklistItem[];
}

export function updateChecklistItemStatus(
  id: string,
  status: ChecklistItemStatus,
  opts?: { notes?: string; updatedBy?: string },
): ReviewChecklistItem {
  const item = getChecklistItem(id);
  validateChecklistItemTransition(item.status as ChecklistItemStatus, status);
  const db = _getDb();
  db.update(s.reviewChecklistItems)
    .set({
      status,
      notes: opts?.notes ?? item.notes,
      updatedBy: opts?.updatedBy ?? item.updatedBy,
      updatedAt: now(),
    })
    .where(eq(s.reviewChecklistItems.id, id))
    .run();
  return getChecklistItem(id);
}

// ── Evidence ─────────────────────────────────────────

export function createEvidence(input: ReviewEvidenceCreate): ReviewEvidence {
  const db = _getDb();
  const id = createId();
  db.insert(s.reviewEvidences).values({
    id,
    reviewRequestId: input.reviewRequestId,
    kind: input.kind,
    title: input.title,
    content: input.content,
    metadataJson: input.metadataJson ?? "",
    createdBy: input.createdBy ?? "",
    createdAt: now(),
  }).run();
  return db.select().from(s.reviewEvidences).where(eq(s.reviewEvidences.id, id)).get() as unknown as ReviewEvidence;
}

export function listEvidence(reviewRequestId: string): ReviewEvidence[] {
  const db = _getDb();
  return db.select().from(s.reviewEvidences)
    .where(eq(s.reviewEvidences.reviewRequestId, reviewRequestId))
    .all() as unknown as ReviewEvidence[];
}

// ── Change Requests ──────────────────────────────────

export function createChangeRequest(input: ChangeRequestCreate): ChangeRequest {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.changeRequests).values({
    id,
    reviewRequestId: input.reviewRequestId,
    summary: input.summary,
    items: input.items ?? "",
    status: ChangeRequestStatus.OPEN,
    evidenceId: null,
    requestedBy: input.requestedBy ?? "",
    addressedBy: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return db.select().from(s.changeRequests).where(eq(s.changeRequests.id, id)).get() as unknown as ChangeRequest;
}

export function getChangeRequest(id: string): ChangeRequest {
  const db = _getDb();
  const row = db.select().from(s.changeRequests).where(eq(s.changeRequests.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as ChangeRequest;
}

export function listChangeRequests(reviewRequestId: string): ChangeRequest[] {
  const db = _getDb();
  return db.select().from(s.changeRequests)
    .where(eq(s.changeRequests.reviewRequestId, reviewRequestId))
    .all() as unknown as ChangeRequest[];
}

export function updateChangeRequestStatus(
  id: string,
  status: ChangeRequestStatus,
  opts?: { evidenceId?: string; addressedBy?: string },
): ChangeRequest {
  const cr = getChangeRequest(id);
  validateChangeRequestTransition(cr.status as ChangeRequestStatus, status);
  const db = _getDb();
  db.update(s.changeRequests)
    .set({
      status,
      evidenceId: opts?.evidenceId ?? cr.evidenceId,
      addressedBy: opts?.addressedBy ?? cr.addressedBy,
      updatedAt: now(),
    })
    .where(eq(s.changeRequests.id, id))
    .run();
  return getChangeRequest(id);
}

// ── Approval Records ─────────────────────────────────

export function createApprovalRecord(input: ApprovalRecordCreate): ApprovalRecord {
  const db = _getDb();
  const id = createId();
  db.insert(s.approvalRecords).values({
    id,
    reviewRequestId: input.reviewRequestId,
    decision: input.decision,
    summary: input.summary,
    requestedChanges: input.requestedChanges ?? "",
    waiverReason: input.waiverReason ?? "",
    decidedBy: input.decidedBy ?? "",
    createdAt: now(),
  }).run();
  return db.select().from(s.approvalRecords).where(eq(s.approvalRecords.id, id)).get() as unknown as ApprovalRecord;
}

export function listApprovalRecords(reviewRequestId: string): ApprovalRecord[] {
  const db = _getDb();
  return db.select().from(s.approvalRecords)
    .where(eq(s.approvalRecords.reviewRequestId, reviewRequestId))
    .all() as unknown as ApprovalRecord[];
}
