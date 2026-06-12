/**
 * SyncGate repository — CRUD for normalized sync_gate + join tables.
 *
 * Domain type SyncGate still uses CSV strings (requiredAgentIds, ackedAgentIds,
 * relatedClaimIds, relatedFiles/relatedResourcesJson). This repo reconstructs
 * those from join tables so the service layer contract is unchanged.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { ResourceNotFoundError, SyncGateStatus, GatePolicySchema, DEFAULT_GATE_POLICY } from "syncpoint-kernel";
import type { SyncGate, SyncGateCreate, GateAck, GateAckCreate, GateVote, GateVoteCreate, ResourceRef, ResourceScope } from "syncpoint-kernel";
import { _getDb, now, createId } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function hydrateGate(db: ReturnType<typeof _getDb>, row: any): SyncGate {
  const reqRows = db.select().from(s.syncGateRequiredAgents)
    .where(eq(s.syncGateRequiredAgents.gateId, row.id)).all();
  const requiredAgentIds = [...new Set(reqRows.map(r => r.agentId))];

  const ackRows = db.select().from(s.syncGateAcks)
    .where(eq(s.syncGateAcks.gateId, row.id)).all();
  const ackedAgentIds = [...new Set(ackRows.map(r => r.agentId))];

  const resRows = db.select().from(s.syncGateResources)
    .where(eq(s.syncGateResources.gateId, row.id)).all();
  const relatedResources = resRows.map(r => ({
    type: r.resourceType,
    locator: r.locator,
    scope: (r.scope || "file") as ResourceScope,
    ...(r.functionName ? { functionName: r.functionName } : {}),
    ...(r.lineStart != null && r.lineEnd != null ? { lineRange: { start: r.lineStart, end: r.lineEnd } } : {}),
    metadata: r.metadata,
  })) as ResourceRef[];
  const relatedFiles = [...new Set(resRows
    .filter(r => r.resourceType === "file")
    .map(r => r.locator)
  )];

  const claimRows = db.select().from(s.syncGateRelatedClaims)
    .where(eq(s.syncGateRelatedClaims.gateId, row.id)).all();
  const relatedClaimIds = [...new Set(claimRows.map(r => r.claimId))];
  const policy = (() => {
    if (!row.policyJson) return { ...DEFAULT_GATE_POLICY };
    try {
      return GatePolicySchema.parse(row.policyJson);
    } catch {
      return { ...DEFAULT_GATE_POLICY };
    }
  })();

  return {
    id: row.id,
    sessionId: row.sessionId ?? "",
    taskId: row.taskId,
    requestedByAgentId: row.requestedByAgentId,
    requiredAgentIds,
    ackedAgentIds,
    reason: row.reason,
    description: row.description ?? "",
    relatedFiles,
    relatedResources,
    relatedCheckpointId: row.relatedCheckpointId ?? "",
    relatedClaimIds,
    status: row.status,
    decisionSummary: row.decisionSummary ?? "",
    policy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as SyncGate;
}

// ── CRUD ────────────────────────────────────────────

export function createSyncGate(data: SyncGateCreate): SyncGate {
  const db = _getDb();
  const id = createId();
  const ts = now();
  const policyJson = data.policy ?? DEFAULT_GATE_POLICY;
  db.insert(s.syncGates).values({
    id,
    sessionId: data.sessionId ?? "",
    taskId: data.taskId,
    requestedByAgentId: data.requestedByAgentId,
    reason: data.reason ?? "manual_request",
    description: data.description ?? "",
    relatedCheckpointId: data.relatedCheckpointId ?? "",
    status: SyncGateStatus.NEEDS_SYNC,
    decisionSummary: "",
    policyJson,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  // Insert required agents
  for (const agentId of data.requiredAgentIds) {
    db.insert(s.syncGateRequiredAgents).values({
      id: createId(),
      gateId: id,
      agentId,
    }).run();
  }
  const resourceMap = new Map<string, ResourceRef>();
  for (const ref of data.relatedResources ?? []) {
    resourceMap.set(`${ref.type}::${ref.locator}::${ref.metadata ?? ""}`, { ...ref, metadata: ref.metadata ?? "" });
  }
  for (const locator of data.relatedFiles ?? []) {
    resourceMap.set(`file::${locator}::`, { type: "file", scope: "file" as const, locator, metadata: "" });
  }
  for (const ref of resourceMap.values()) {
    db.insert(s.syncGateResources).values({
      id: createId(),
      gateId: id,
      resourceType: ref.type,
      locator: ref.locator,
      scope: ref.scope,
      functionName: ref.functionName ?? null,
      lineStart: ref.lineRange?.start ?? null,
      lineEnd: ref.lineRange?.end ?? null,
      metadata: ref.metadata ?? "",
    }).run();
  }
  for (const cid of data.relatedClaimIds ?? []) {
    if (!cid) continue;
      db.insert(s.syncGateRelatedClaims).values({
        id: createId(),
        gateId: id,
        claimId: cid,
      }).run();
  }
  return getSyncGate(id);
}

export function getSyncGate(id: string): SyncGate {
  const db = _getDb();
  const row = db.select().from(s.syncGates).where(eq(s.syncGates.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return hydrateGate(db, row);
}

export function updateSyncGateStatus(id: string, status: SyncGateStatus, decisionSummary?: string): SyncGate {
  const db = _getDb();
  const updates: Record<string, unknown> = { status, updatedAt: now() };
  if (decisionSummary !== undefined) updates.decisionSummary = decisionSummary;
  db.update(s.syncGates).set(updates).where(eq(s.syncGates.id, id)).run();
  return getSyncGate(id);
}

export function updateSyncGateDescription(id: string, description: string): SyncGate {
  const db = _getDb();
  db.update(s.syncGates).set({
    description,
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

  const rows = conditions.length === 0
    ? db.select().from(s.syncGates).all()
    : db.select().from(s.syncGates).where(and(...conditions)).all();
  return rows.map(row => hydrateGate(db, row));
}

export function updateSyncGatePolicyJson(id: string, policyJson: import("syncpoint-core").GatePolicy): SyncGate {
  const db = _getDb();
  db.update(s.syncGates).set({ policyJson, updatedAt: now() }).where(eq(s.syncGates.id, id)).run();
  return getSyncGate(id);
}

export function listActiveSyncGates(opts?: {
  taskId?: string;
  sessionId?: string;
}): SyncGate[] {
  const db = _getDb();
  const activeStatuses = [
    SyncGateStatus.NEEDS_SYNC,
    SyncGateStatus.SYNC_REQUESTED,
    SyncGateStatus.PARTIALLY_ACKED,
    SyncGateStatus.SYNC_ACKED,
    SyncGateStatus.ESCALATED,
    SyncGateStatus.TIMED_OUT,
    SyncGateStatus.BYPASS_REQUESTED,
  ];

  const conditions = [inArray(s.syncGates.status, activeStatuses)];
  if (opts?.taskId) conditions.push(eq(s.syncGates.taskId, opts.taskId));
  if (opts?.sessionId) conditions.push(eq(s.syncGates.sessionId, opts.sessionId));

  const rows = db.select().from(s.syncGates)
    .where(and(...conditions))
    .all();
  return rows.map(row => hydrateGate(db, row));
}

/**
 * List gates whose related claims include any of the given claim IDs.
 * Uses the sync_gate_related_claim join table.
 */
export function listGatesByRelatedClaimIds(claimIds: string[]): SyncGate[] {
  const allActive = listActiveSyncGates();
  return allActive.filter(g => {
    return claimIds.some(cid => g.relatedClaimIds.includes(cid));
  });
}

// ── Gate Ack CRUD ─────────────────────────────

export function createGateAck(data: GateAckCreate): GateAck {
  const db = _getDb();
  const id = createId();
  const ts = now();

  // Idempotent upsert: one ack per (gateId, agentId). Re-ack updates summary/timestamp.
  db.insert(s.syncGateAcks).values({
    id,
    gateId: data.gateId,
    agentId: data.agentId,
    summary: data.summary ?? "",
    createdAt: ts,
  }).onConflictDoUpdate({
    target: [s.syncGateAcks.gateId, s.syncGateAcks.agentId],
    set: {
      summary: data.summary ?? "",
      createdAt: ts,
    },
  }).run();

  const row = db.select().from(s.syncGateAcks)
    .where(and(eq(s.syncGateAcks.gateId, data.gateId), eq(s.syncGateAcks.agentId, data.agentId)))
    .get();
  return row as unknown as GateAck;
}

export function getGateAck(id: string): GateAck {
  const db = _getDb();
  const row = db.select().from(s.syncGateAcks).where(eq(s.syncGateAcks.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as GateAck;
}

export function listGateAcks(gateId: string): GateAck[] {
  const db = _getDb();
  return db.select().from(s.syncGateAcks)
    .where(eq(s.syncGateAcks.gateId, gateId))
    .all() as unknown as GateAck[];
}

// ── Gate Vote CRUD ──────────────────────────────────

export function createGateVote(data: GateVoteCreate): GateVote {
  const db = _getDb();
  const id = createId();
  const ts = now();

  // Atomic upsert: one vote per (gateId, agentId). Last vote wins.
  db.insert(s.syncGateVotes).values({
    id,
    gateId: data.gateId,
    agentId: data.agentId,
    vote: data.vote,
    summary: data.summary ?? "",
    createdAt: ts,
  }).onConflictDoUpdate({
    target: [s.syncGateVotes.gateId, s.syncGateVotes.agentId],
    set: {
      vote: data.vote,
      summary: data.summary ?? "",
      createdAt: ts,
    },
  }).run();

  const row = db.select().from(s.syncGateVotes)
    .where(and(eq(s.syncGateVotes.gateId, data.gateId), eq(s.syncGateVotes.agentId, data.agentId)))
    .get();
  return row as unknown as GateVote;
}

export function getGateVote(id: string): GateVote {
  const db = _getDb();
  const row = db.select().from(s.syncGateVotes).where(eq(s.syncGateVotes.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as GateVote;
}

export function listGateVotes(gateId: string): GateVote[] {
  const db = _getDb();
  return db.select().from(s.syncGateVotes)
    .where(eq(s.syncGateVotes.gateId, gateId))
    .all() as unknown as GateVote[];
}
