import { and, eq } from "drizzle-orm";
import type { WriteDecision, WritePermit, WritePermitCreate, WriteResourceHash, ResourceRef, ResourceScope } from "syncpoint-kernel";
import * as s from "../schema.js";
import { _getDb, createId, now } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function loadPermitResources(db: ReturnType<typeof _getDb>, permitId: string): { resources: ResourceRef[]; baseHashes: WriteResourceHash[] } {
  const rows = db.select().from(s.writePermitResources)
    .where(eq(s.writePermitResources.permitId, permitId))
    .all();
  const resources: ResourceRef[] = [];
  const baseHashes: WriteResourceHash[] = [];
  for (const r of rows) {
    const ref: ResourceRef = {
      type: r.resourceType,
      locator: r.locator,
      scope: (r.scope || "file") as ResourceScope,
      ...(r.functionName ? { functionName: r.functionName } : {}),
      ...(r.lineStart != null && r.lineEnd != null ? { lineRange: { start: r.lineStart, end: r.lineEnd } } : {}),
      metadata: r.metadata,
    };
    resources.push(ref);
    baseHashes.push({ resource: ref, sha256: r.baseHash || undefined, exists: !!r.baseHash });
  }
  return { resources, baseHashes };
}

function rowToWritePermit(row: any, resources: ResourceRef[], baseHashes: WriteResourceHash[]): WritePermit {
  return {
    id: row.id,
    actorId: row.actorId,
    taskId: row.taskId,
    sessionId: row.sessionId ?? "",
    resources,
    intent: row.intent,
    operationId: row.operationId ?? "",
    guardedRoot: row.guardedRoot ?? "",
    baseHashes,
    expiresAt: row.expiresAt,
    singleUse: Boolean(row.singleUse),
    status: row.status,
    decision: row.decisionJson ?? { permitted: false, reason: "blocked" as any, blockers: [], warnings: [] },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    consumedAt: row.consumedAt ?? "",
  };
}

function hydratePermit(db: ReturnType<typeof _getDb>, row: any): WritePermit {
  const { resources, baseHashes } = loadPermitResources(db, row.id);
  return rowToWritePermit(row, resources, baseHashes);
}

// ── CRUD ────────────────────────────────────────────

export function createWritePermit(data: WritePermitCreate): WritePermit {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.writePermits).values({
    id,
    actorId: data.actorId,
    taskId: data.taskId,
    sessionId: data.sessionId ?? "",
    intent: data.intent,
    operationId: data.operationId ?? "",
    guardedRoot: data.guardedRoot,
    expiresAt: data.expiresAt,
    singleUse: data.singleUse,
    status: data.status,
    decisionJson: data.decision,
    createdAt: ts,
    updatedAt: ts,
    consumedAt: "",
  }).run();
  // Build a baseHash lookup from data.baseHashes keyed by locator
  const hashMap = new Map<string, WriteResourceHash>();
  for (const bh of (data.baseHashes ?? [])) {
    hashMap.set(bh.resource.locator, bh);
  }
  // Insert resources into join table
  for (const ref of data.resources) {
    const bh = hashMap.get(ref.locator);
    db.insert(s.writePermitResources).values({
      id: createId(),
      permitId: id,
      resourceType: ref.type,
      locator: ref.locator,
      baseHash: bh?.sha256 ?? "",
      scope: ref.scope,
      functionName: ref.functionName ?? null,
      lineStart: ref.lineRange?.start ?? null,
      lineEnd: ref.lineRange?.end ?? null,
      metadata: ref.metadata ?? "",
    }).run();
  }
  return getWritePermit(id);
}

export function getWritePermit(id: string): WritePermit {
  const db = _getDb();
  const row = db.select().from(s.writePermits).where(eq(s.writePermits.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return hydratePermit(db, row);
}

export function updateWritePermit(id: string, updates: Partial<Pick<WritePermit, "status" | "decision" | "consumedAt" | "expiresAt">>): WritePermit {
  const db = _getDb();
  const data: Record<string, unknown> = { updatedAt: now() };
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.decision !== undefined) data.decisionJson = updates.decision;
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
  return rows.map(row => hydratePermit(db, row));
}
