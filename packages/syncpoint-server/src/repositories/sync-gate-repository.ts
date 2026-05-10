/**
 * SyncGate repository — CRUD for normalized sync_gate + join tables.
 *
 * Domain type SyncGate still uses CSV strings (requiredAgentIds, ackedAgentIds,
 * relatedClaimIds, relatedFiles/relatedResourcesJson). This repo reconstructs
 * those from join tables so the service layer contract is unchanged.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { SyncGateStatus } from "syncpoint-core";
import type { SyncGate, SyncGateCreate, GateVote, GateVoteCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function hydrateGate(db: ReturnType<typeof _getDb>, row: any): SyncGate {
  // Required agents from join table → CSV
  const reqRows = db.select().from(s.syncGateRequiredAgents)
    .where(eq(s.syncGateRequiredAgents.gateId, row.id)).all();
  const requiredAgentIds = reqRows.map(r => r.agentId).join(",");

  // Acked agents = votes with vote === "ack"
  const votes = db.select().from(s.syncGateVotes)
    .where(eq(s.syncGateVotes.gateId, row.id)).all();
  const ackedAgentIds = votes.filter(v => v.vote === "ack").map(v => v.agentId).join(",");

  // Related resources → JSON string
  const resRows = db.select().from(s.syncGateResources)
    .where(eq(s.syncGateResources.gateId, row.id)).all();
  const relatedResourcesJson = resRows.length > 0
    ? JSON.stringify(resRows.map(r => ({ type: r.resourceType, locator: r.locator, metadata: r.metadata })))
    : "";

  // Related files = resource locators where type === "file"
  const relatedFiles = resRows
    .filter(r => r.resourceType === "file")
    .map(r => r.locator)
    .join(",");

  // Related claim IDs from join table → CSV
  const claimRows = db.select().from(s.syncGateRelatedClaims)
    .where(eq(s.syncGateRelatedClaims.gateId, row.id)).all();
  const relatedClaimIds = claimRows.map(r => r.claimId).join(",");

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
    relatedResourcesJson,
    relatedCheckpointId: row.relatedCheckpointId ?? "",
    relatedClaimIds,
    status: row.status,
    decisionSummary: row.decisionSummary ?? "",
    policyJson: row.policyJson ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as SyncGate;
}

// ── CRUD ────────────────────────────────────────────

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
  // Insert related resources (from relatedResourcesJson if provided)
  if (data.relatedResourcesJson) {
    try {
      const refs = JSON.parse(data.relatedResourcesJson) as Array<{ type: string; locator: string; metadata?: string }>;
      for (const ref of refs) {
        db.insert(s.syncGateResources).values({
          id: createId(),
          gateId: id,
          resourceType: ref.type,
          locator: ref.locator,
          metadata: ref.metadata ?? "",
        }).run();
      }
    } catch { /* ignore invalid JSON */ }
  }
  // Insert related files as file-type resources
  if (data.relatedFiles) {
    const paths = data.relatedFiles.split(",").map(p => p.trim()).filter(Boolean);
    for (const p of paths) {
      db.insert(s.syncGateResources).values({
        id: createId(),
        gateId: id,
        resourceType: "file",
        locator: p,
        metadata: "",
      }).run();
    }
  }
  // Insert related claim IDs
  if (data.relatedClaimIds) {
    const cids = data.relatedClaimIds.split(",").map(c => c.trim()).filter(Boolean);
    for (const cid of cids) {
      db.insert(s.syncGateRelatedClaims).values({
        id: createId(),
        gateId: id,
        claimId: cid,
      }).run();
    }
  }
  return getSyncGate(id);
}

export function getSyncGate(id: string): SyncGate {
  const db = _getDb();
  const row = db.select().from(s.syncGates).where(eq(s.syncGates.id, id)).get();
  if (!row) throw new Error(`sync_gate not found: ${id}`);
  return hydrateGate(db, row);
}

export function updateSyncGateStatus(id: string, status: SyncGateStatus, decisionSummary?: string): SyncGate {
  const db = _getDb();
  const updates: Record<string, unknown> = { status, updatedAt: now() };
  if (decisionSummary !== undefined) updates.decisionSummary = decisionSummary;
  db.update(s.syncGates).set(updates).where(eq(s.syncGates.id, id)).run();
  return getSyncGate(id);
}

export function updateSyncGateAckedAgents(id: string, ackedAgentIds: string): SyncGate {
  // ackedAgentIds is now derived from votes, so this is a no-op on the gate row.
  // The caller should use createGateVote instead. We still return the gate.
  const db = _getDb();
  db.update(s.syncGates).set({ updatedAt: now() }).where(eq(s.syncGates.id, id)).run();
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
  if (!row) throw new Error(`sync_gate_vote not found: ${id}`);
  return row as unknown as GateVote;
}

export function listGateVotes(gateId: string): GateVote[] {
  const db = _getDb();
  return db.select().from(s.syncGateVotes)
    .where(eq(s.syncGateVotes.gateId, gateId))
    .all() as unknown as GateVote[];
}
