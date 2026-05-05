/**
 * SyncGate repository — CRUD for sync_gate table.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { SyncGateStatus } from "syncpoint-core";
import type { SyncGate, SyncGateCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

export function createSyncGate(data: SyncGateCreate): SyncGate {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.syncGates).values({
    id,
    sessionId: data.sessionId ?? "",
    taskId: data.taskId,
    requestedByAgentId: data.requestedByAgentId,
    requiredAgentIds: data.requiredAgentIds.join(","),
    ackedAgentIds: "",
    reason: data.reason ?? "manual_request",
    description: data.description ?? "",
    relatedFiles: data.relatedFiles ?? "",
    relatedResourcesJson: data.relatedResourcesJson ?? "",
    relatedCheckpointId: data.relatedCheckpointId ?? "",
    relatedClaimIds: data.relatedClaimIds ?? "",
    status: SyncGateStatus.NEEDS_SYNC,
    decisionSummary: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return getSyncGate(id);
}

export function getSyncGate(id: string): SyncGate {
  const db = _getDb();
  const row = db.select().from(s.syncGates).where(eq(s.syncGates.id, id)).get();
  if (!row) throw new Error(`sync_gate not found: ${id}`);
  return row as unknown as SyncGate;
}

export function updateSyncGateStatus(id: string, status: SyncGateStatus, decisionSummary?: string): SyncGate {
  const db = _getDb();
  const updates: Record<string, unknown> = { status, updatedAt: now() };
  if (decisionSummary !== undefined) updates.decisionSummary = decisionSummary;
  db.update(s.syncGates).set(updates).where(eq(s.syncGates.id, id)).run();
  return getSyncGate(id);
}

export function updateSyncGateAckedAgents(id: string, ackedAgentIds: string): SyncGate {
  const db = _getDb();
  db.update(s.syncGates).set({
    ackedAgentIds,
    updatedAt: now(),
  }).where(eq(s.syncGates.id, id)).run();
  return getSyncGate(id);
}

export function listSyncGates(opts?: {
  taskId?: string;
  sessionId?: string;
  status?: string;
}): SyncGate[] {
  const db = _getDb();
  const conditions = [];
  if (opts?.taskId) conditions.push(eq(s.syncGates.taskId, opts.taskId));
  if (opts?.sessionId) conditions.push(eq(s.syncGates.sessionId, opts.sessionId));
  if (opts?.status) conditions.push(eq(s.syncGates.status, opts.status));

  if (conditions.length === 0) {
    return db.select().from(s.syncGates).all() as unknown as SyncGate[];
  }
  return db.select().from(s.syncGates)
    .where(and(...conditions))
    .all() as unknown as SyncGate[];
}

/**
 * List active (blocking) sync gates for a given task or session.
 */
export function listActiveSyncGates(opts?: {
  taskId?: string;
  sessionId?: string;
}): SyncGate[] {
  const db = _getDb();
  const activeStatuses = [
    SyncGateStatus.NEEDS_SYNC,
    SyncGateStatus.SYNC_REQUESTED,
    SyncGateStatus.SYNC_ACKED,
  ];

  const conditions = [inArray(s.syncGates.status, activeStatuses)];
  if (opts?.taskId) conditions.push(eq(s.syncGates.taskId, opts.taskId));
  if (opts?.sessionId) conditions.push(eq(s.syncGates.sessionId, opts.sessionId));

  return db.select().from(s.syncGates)
    .where(and(...conditions))
    .all() as unknown as SyncGate[];
}
