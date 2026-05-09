/**
 * SyncGate repository — CRUD for sync_gate table.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { SyncGateStatus } from "syncpoint-core";
import type { SyncGate, SyncGateCreate, GateVote, GateVoteCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

export function createSyncGate(data: SyncGateCreate): SyncGate {
  const db = _getDb();
  const id = createId();
  const ts = now();
  const policyJson = data.policy ? JSON.stringify(data.policy) : "";
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
    policyJson,
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

  if (conditions.length === 0) {
    return db.select().from(s.syncGates).all() as unknown as SyncGate[];
  }
  return db.select().from(s.syncGates)
    .where(and(...conditions))
    .all() as unknown as SyncGate[];
}

export function updateSyncGatePolicyJson(id: string, policyJson: string): SyncGate {
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

  return db.select().from(s.syncGates)
    .where(and(...conditions))
    .all() as unknown as SyncGate[];
}

/**
 * List gates whose relatedClaimIds include any of the given claim IDs.
 * Used by rcRelease to reconcile resource conflict gates.
 */
export function listGatesByRelatedClaimIds(claimIds: string[]): SyncGate[] {
  const allActive = listActiveSyncGates();
  return allActive.filter(g => {
    if (!g.relatedClaimIds) return false;
    const gateClaimIds = g.relatedClaimIds.split(",").map(c => c.trim()).filter(Boolean);
    return claimIds.some(cid => gateClaimIds.includes(cid));
  });
}

// ── Gate Vote CRUD ──────────────────────────────────

export function createGateVote(data: GateVoteCreate): GateVote {
  const db = _getDb();
  const id = createId();
  const ts = now();

  // Atomic upsert: one vote per (gateId, agentId). Last vote wins.
  // ON CONFLICT on the unique index (gate_id, agent_id) → update in place.
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

  // Return the (possibly updated) row
  const row = db.select().from(s.syncGateVotes)
    .where(and(eq(s.syncGateVotes.gateId, data.gateId), eq(s.syncGateVotes.agentId, data.agentId)))
    .get();
  return row as unknown as GateVote;
}

export function getGateVote(id: string): GateVote {
  const db = _getDb();
  const row = db.select().from(s.syncGateVotes).where(eq(s.syncGateVotes.id, id)).get();
  if (!row) throw new Error(`sync_gate_vote not found: ${id}`);
  return row as unknown as GateVote;
}

export function listGateVotes(gateId: string): GateVote[] {
  const db = _getDb();
  return db.select().from(s.syncGateVotes)
    .where(eq(s.syncGateVotes.gateId, gateId))
    .all() as unknown as GateVote[];
}
