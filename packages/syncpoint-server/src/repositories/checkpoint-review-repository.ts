/**
 * CheckpointReview repository — CRUD for normalized checkpoint_review + checkpoint_review_approver tables.
 *
 * Domain type CheckpointReview still uses CSV strings (requiredApproverIds,
 * approvedByIds, rejectedByIds). This repo reconstructs those from the join table.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { CheckpointReviewStatus } from "syncpoint-core";
import type { CheckpointReview, CheckpointReviewCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function hydrateReview(db: ReturnType<typeof _getDb>, row: any): CheckpointReview {
  const approvers = db.select().from(s.checkpointReviewApprovers)
    .where(eq(s.checkpointReviewApprovers.reviewId, row.id)).all();

  const requiredApproverIds = approvers.map(a => a.agentId) as unknown as CheckpointReview["requiredApproverIds"];
  const approvedByIds = approvers.filter(a => a.role === "approved").map(a => a.agentId) as unknown as CheckpointReview["approvedByIds"];
  const rejectedByIds = approvers.filter(a => a.role === "rejected").map(a => a.agentId) as unknown as CheckpointReview["rejectedByIds"];

  return {
    id: row.id,
    sessionId: row.sessionId ?? "",
    taskId: row.taskId,
    checkpointId: row.checkpointId,
    requestingAgentId: row.requestingAgentId,
    requiredApproverIds,
    approvedByIds,
    rejectedByIds,
    gateId: row.gateId ?? "",
    status: row.status as CheckpointReviewStatus,
    decisionSummary: row.decisionSummary ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── CRUD ────────────────────────────────────────────

export function createCheckpointReview(data: CheckpointReviewCreate & { gateId?: string }): CheckpointReview {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.checkpointReviews).values({
    id,
    sessionId: data.sessionId,
    taskId: data.taskId,
    checkpointId: data.checkpointId,
    requestingAgentId: data.requestingAgentId,
    gateId: data.gateId ?? "",
    status: CheckpointReviewStatus.OPEN,
    decisionSummary: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  // Insert required approvers into join table
  for (const agentId of data.requiredApproverIds) {
    db.insert(s.checkpointReviewApprovers).values({
      id: createId(),
      reviewId: id,
      agentId,
      role: "required",
      decidedAt: "",
    }).run();
  }
  return getCheckpointReview(id);
}

export function getCheckpointReview(id: string): CheckpointReview {
  const db = _getDb();
  const row = db.select().from(s.checkpointReviews).where(eq(s.checkpointReviews.id, id)).get();
  if (!row) throw new Error(`checkpoint_review not found: ${id}`);
  return hydrateReview(db, row);
}

export function updateCheckpointReviewStatus(
  id: string,
  status: CheckpointReviewStatus,
  decisionSummary?: string,
): CheckpointReview {
  const db = _getDb();
  const updates: Record<string, unknown> = { status, updatedAt: now() };
  if (decisionSummary !== undefined) updates.decisionSummary = decisionSummary;
  db.update(s.checkpointReviews).set(updates).where(eq(s.checkpointReviews.id, id)).run();
  return getCheckpointReview(id);
}

export function approveCheckpointReviewBy(id: string, agentId: string): CheckpointReview {
  const db = _getDb();
  db.update(s.checkpointReviewApprovers).set({
    role: "approved",
    decidedAt: now(),
  }).where(
    and(eq(s.checkpointReviewApprovers.reviewId, id), eq(s.checkpointReviewApprovers.agentId, agentId))
  ).run();
  db.update(s.checkpointReviews).set({ updatedAt: now() }).where(eq(s.checkpointReviews.id, id)).run();
  return getCheckpointReview(id);
}

export function rejectCheckpointReviewBy(id: string, agentId: string): CheckpointReview {
  const db = _getDb();
  db.update(s.checkpointReviewApprovers).set({
    role: "rejected",
    decidedAt: now(),
  }).where(
    and(eq(s.checkpointReviewApprovers.reviewId, id), eq(s.checkpointReviewApprovers.agentId, agentId))
  ).run();
  db.update(s.checkpointReviews).set({ updatedAt: now() }).where(eq(s.checkpointReviews.id, id)).run();
  return getCheckpointReview(id);
}

export function updateCheckpointReviewGateId(id: string, gateId: string): CheckpointReview {
  const db = _getDb();
  db.update(s.checkpointReviews).set({
    gateId,
    updatedAt: now(),
  }).where(eq(s.checkpointReviews.id, id)).run();
  return getCheckpointReview(id);
}

export function listCheckpointReviews(opts?: {
  sessionId?: string;
  taskId?: string;
  status?: string;
}): CheckpointReview[] {
  const db = _getDb();
  const conditions = [];
  if (opts?.sessionId) conditions.push(eq(s.checkpointReviews.sessionId, opts.sessionId));
  if (opts?.taskId) conditions.push(eq(s.checkpointReviews.taskId, opts.taskId));
  if (opts?.status) conditions.push(eq(s.checkpointReviews.status, opts.status));

  const rows = conditions.length === 0
    ? db.select().from(s.checkpointReviews).all()
    : db.select().from(s.checkpointReviews).where(and(...conditions)).all();
  return rows.map(row => hydrateReview(db, row));
}

export function listActiveCheckpointReviews(opts?: {
  sessionId?: string;
  taskId?: string;
}): CheckpointReview[] {
  const db = _getDb();
  const activeStatuses = [
    CheckpointReviewStatus.OPEN,
    CheckpointReviewStatus.WAITING_APPROVAL,
    CheckpointReviewStatus.REJECTED,
  ];
  const conditions = [inArray(s.checkpointReviews.status, activeStatuses)];
  if (opts?.sessionId) conditions.push(eq(s.checkpointReviews.sessionId, opts.sessionId));
  if (opts?.taskId) conditions.push(eq(s.checkpointReviews.taskId, opts.taskId));

  const rows = db.select().from(s.checkpointReviews)
    .where(and(...conditions))
    .all();
  return rows.map(row => hydrateReview(db, row));
}
