/**
 * SyncTransaction repository — CRUD for sync_transaction table.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { SyncTransactionStatus } from "syncpoint-core";
import type { SyncTransaction, SyncTransactionCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

export function createSyncTransaction(data: SyncTransactionCreate & { gateId?: string }): SyncTransaction {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.syncTransactions).values({
    id,
    sessionId: data.sessionId,
    taskId: data.taskId,
    checkpointId: data.checkpointId,
    requestingAgentId: data.requestingAgentId,
    requiredApproverIds: data.requiredApproverIds.join(","),
    approvedByIds: "",
    rejectedByIds: "",
    gateId: data.gateId ?? "",
    status: SyncTransactionStatus.OPEN,
    decisionSummary: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return getSyncTransaction(id);
}

export function getSyncTransaction(id: string): SyncTransaction {
  const db = _getDb();
  const row = db.select().from(s.syncTransactions).where(eq(s.syncTransactions.id, id)).get();
  if (!row) throw new Error(`sync_transaction not found: ${id}`);
  return row as unknown as SyncTransaction;
}

export function updateSyncTransactionStatus(
  id: string,
  status: SyncTransactionStatus,
  decisionSummary?: string,
): SyncTransaction {
  const db = _getDb();
  const updates: Record<string, unknown> = { status, updatedAt: now() };
  if (decisionSummary !== undefined) updates.decisionSummary = decisionSummary;
  db.update(s.syncTransactions).set(updates).where(eq(s.syncTransactions.id, id)).run();
  return getSyncTransaction(id);
}

export function updateSyncTransactionApprovedBy(id: string, approvedByIds: string): SyncTransaction {
  const db = _getDb();
  db.update(s.syncTransactions).set({
    approvedByIds,
    updatedAt: now(),
  }).where(eq(s.syncTransactions.id, id)).run();
  return getSyncTransaction(id);
}

export function updateSyncTransactionRejectedBy(id: string, rejectedByIds: string): SyncTransaction {
  const db = _getDb();
  db.update(s.syncTransactions).set({
    rejectedByIds,
    updatedAt: now(),
  }).where(eq(s.syncTransactions.id, id)).run();
  return getSyncTransaction(id);
}

export function updateSyncTransactionGateId(id: string, gateId: string): SyncTransaction {
  const db = _getDb();
  db.update(s.syncTransactions).set({
    gateId,
    updatedAt: now(),
  }).where(eq(s.syncTransactions.id, id)).run();
  return getSyncTransaction(id);
}

export function listSyncTransactions(opts?: {
  sessionId?: string;
  taskId?: string;
  status?: string;
}): SyncTransaction[] {
  const db = _getDb();
  const conditions = [];
  if (opts?.sessionId) conditions.push(eq(s.syncTransactions.sessionId, opts.sessionId));
  if (opts?.taskId) conditions.push(eq(s.syncTransactions.taskId, opts.taskId));
  if (opts?.status) conditions.push(eq(s.syncTransactions.status, opts.status));

  if (conditions.length === 0) {
    return db.select().from(s.syncTransactions).all() as unknown as SyncTransaction[];
  }
  return db.select().from(s.syncTransactions)
    .where(and(...conditions))
    .all() as unknown as SyncTransaction[];
}

export function listActiveSyncTransactions(opts?: {
  sessionId?: string;
  taskId?: string;
}): SyncTransaction[] {
  const db = _getDb();
  const activeStatuses = [
    SyncTransactionStatus.OPEN,
    SyncTransactionStatus.WAITING_APPROVAL,
    SyncTransactionStatus.REJECTED,
  ];
  const conditions = [inArray(s.syncTransactions.status, activeStatuses)];
  if (opts?.sessionId) conditions.push(eq(s.syncTransactions.sessionId, opts.sessionId));
  if (opts?.taskId) conditions.push(eq(s.syncTransactions.taskId, opts.taskId));

  return db.select().from(s.syncTransactions)
    .where(and(...conditions))
    .all() as unknown as SyncTransaction[];
}
