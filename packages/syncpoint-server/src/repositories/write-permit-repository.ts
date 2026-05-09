import { and, eq } from "drizzle-orm";
import type { WriteDecision, WritePermit, WritePermitCreate, WriteResourceHash, ResourceRef } from "syncpoint-core";
import * as s from "../schema.js";
import { _getDb, createId, now } from "./_shared.js";

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function rowToWritePermit(row: any): WritePermit {
  return {
    id: row.id,
    actorId: row.actorId,
    taskId: row.taskId,
    sessionId: row.sessionId ?? "",
    resources: parseJson<ResourceRef[]>(row.resourcesJson, []),
    intent: row.intent,
    operationId: row.operationId ?? "",
    guardedRoot: row.guardedRoot ?? "",
    baseHashes: parseJson<WriteResourceHash[]>(row.baseHashesJson, []),
    expiresAt: row.expiresAt,
    singleUse: Boolean(row.singleUse),
    status: row.status,
    decision: parseJson<WriteDecision>(row.decisionJson, { permitted: false, reason: "blocked" as any, blockers: [], warnings: [] }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    consumedAt: row.consumedAt ?? "",
  };
}

export function createWritePermit(data: WritePermitCreate): WritePermit {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.writePermits).values({
    id,
    actorId: data.actorId,
    taskId: data.taskId,
    sessionId: data.sessionId ?? "",
    resourcesJson: JSON.stringify(data.resources),
    intent: data.intent,
    operationId: data.operationId ?? "",
    guardedRoot: data.guardedRoot,
    baseHashesJson: JSON.stringify(data.baseHashes ?? []),
    expiresAt: data.expiresAt,
    singleUse: data.singleUse,
    status: data.status,
    decisionJson: JSON.stringify(data.decision),
    createdAt: ts,
    updatedAt: ts,
    consumedAt: "",
  }).run();
  return getWritePermit(id);
}

export function getWritePermit(id: string): WritePermit {
  const db = _getDb();
  const row = db.select().from(s.writePermits).where(eq(s.writePermits.id, id)).get();
  if (!row) throw new Error(`write_permit not found: ${id}`);
  return rowToWritePermit(row);
}

export function updateWritePermit(id: string, updates: Partial<Pick<WritePermit, "status" | "decision" | "consumedAt" | "expiresAt">>): WritePermit {
  const db = _getDb();
  const data: Record<string, unknown> = { updatedAt: now() };
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.decision !== undefined) data.decisionJson = JSON.stringify(updates.decision);
  if (updates.consumedAt !== undefined) data.consumedAt = updates.consumedAt;
  if (updates.expiresAt !== undefined) data.expiresAt = updates.expiresAt;
  db.update(s.writePermits).set(data).where(eq(s.writePermits.id, id)).run();
  return getWritePermit(id);
}

export function listWritePermits(opts?: { actorId?: string; taskId?: string; sessionId?: string; status?: string }): WritePermit[] {
  const db = _getDb();
  const predicates = [];
  if (opts?.actorId) predicates.push(eq(s.writePermits.actorId, opts.actorId));
  if (opts?.taskId) predicates.push(eq(s.writePermits.taskId, opts.taskId));
  if (opts?.sessionId) predicates.push(eq(s.writePermits.sessionId, opts.sessionId));
  if (opts?.status) predicates.push(eq(s.writePermits.status, opts.status));

  const rows = predicates.length === 0
    ? db.select().from(s.writePermits).all()
    : db.select().from(s.writePermits).where(and(...predicates)).all();
  return rows.map(rowToWritePermit);
}
