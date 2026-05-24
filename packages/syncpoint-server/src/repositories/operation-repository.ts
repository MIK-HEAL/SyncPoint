/**
 * Operation repository — CRUD for the normalized operation + operation_resource tables.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import { OperationStatus } from "syncpoint-core";
import type { Operation, OperationCheckResult, OperationCreate, ResourceRef } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function loadTargetResources(db: ReturnType<typeof _getDb>, operationId: string): ResourceRef[] {
  return db.select().from(s.operationResources)
    .where(eq(s.operationResources.operationId, operationId))
    .all()
    .map(r => ({ type: r.resourceType, locator: r.locator, metadata: r.metadata }));
}

function rowToOperation(row: any, targetResources: ResourceRef[]): Operation {
  return {
    id: row.id,
    type: row.type,
    actorId: row.actorId,
    taskId: row.taskId,
    sessionId: row.sessionId ?? "",
    title: row.title,
    summary: row.summary ?? "",
    targetResources,
    payloadRef: row.payloadRef ?? "",
    status: row.status as OperationStatus,
    checkResult: parseJson<OperationCheckResult | null>(row.checkResultJson, null) as unknown as Operation["checkResult"],
    decisionSummary: row.decisionSummary ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── CRUD ────────────────────────────────────────────

export function createOperation(data: OperationCreate): Operation {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.operations).values({
    id,
    type: data.type,
    actorId: data.actorId,
    taskId: data.taskId,
    sessionId: data.sessionId ?? "",
    title: data.title,
    summary: data.summary ?? "",
    payloadRef: data.payloadRef ?? "",
    status: OperationStatus.DRAFT,
    checkResultJson: "",
    decisionSummary: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  // Insert target resources into join table
  for (const ref of (data.targetResources ?? [])) {
    db.insert(s.operationResources).values({
      id: createId(),
      operationId: id,
      resourceType: ref.type,
      locator: ref.locator,
      metadata: ref.metadata ?? "",
    }).run();
  }
  return getOperation(id);
}

export function getOperation(id: string): Operation {
  const db = _getDb();
  const row = db.select().from(s.operations).where(eq(s.operations.id, id)).get();
  if (!row) throw new Error(`operation not found: ${id}`);
  return rowToOperation(row, loadTargetResources(db, id));
}

export function updateOperation(
  id: string,
  updates: Partial<{
    status: string;
    payloadRef: string;
    checkResult: OperationCheckResult | null;
    decisionSummary: string;
  }>,
): Operation {
  const db = _getDb();
  const data: Record<string, unknown> = { updatedAt: now() };
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.payloadRef !== undefined) data.payloadRef = updates.payloadRef;
  if (updates.checkResult !== undefined) data.checkResultJson = updates.checkResult ? JSON.stringify(updates.checkResult) : "";
  if (updates.decisionSummary !== undefined) data.decisionSummary = updates.decisionSummary;
  db.update(s.operations).set(data).where(eq(s.operations.id, id)).run();
  return getOperation(id);
}

export function listOperations(opts?: {
  type?: string;
  actorId?: string;
  taskId?: string;
  sessionId?: string;
  status?: string;
}): Operation[] {
  const db = _getDb();
  const conditions = [];
  if (opts?.type) conditions.push(eq(s.operations.type, opts.type));
  if (opts?.actorId) conditions.push(eq(s.operations.actorId, opts.actorId));
  if (opts?.taskId) conditions.push(eq(s.operations.taskId, opts.taskId));
  if (opts?.sessionId) conditions.push(eq(s.operations.sessionId, opts.sessionId));
  if (opts?.status) conditions.push(eq(s.operations.status, opts.status));

  const rows = conditions.length === 0
    ? db.select().from(s.operations).all()
    : db.select().from(s.operations).where(and(...conditions)).all();

  return rows.map(row => rowToOperation(row, loadTargetResources(db, row.id)));
}
