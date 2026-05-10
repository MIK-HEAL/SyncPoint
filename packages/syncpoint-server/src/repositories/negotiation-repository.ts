/**
 * Negotiation Repository — CRUD for negotiation sessions, participants, and messages.
 *
 * Uses the normalized negotiation_participant join table instead of participantIds CSV.
 * The returned session row is augmented with a reconstructed participantIds CSV
 * for service-layer compat.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import * as schema from "../schema.js";
import { createId } from "./_shared.js";

function now(): string {
  return new Date().toISOString();
}

function hydrateSession(db: ReturnType<typeof getDb>, row: any) {
  const parts = db.select().from(schema.negotiationParticipants)
    .where(eq(schema.negotiationParticipants.sessionId, row.id)).all();
  return { ...row, participantIds: parts.map(p => p.agentId).join(",") };
}

// ── Session CRUD ─────────────────────────────────────

export function createNegotiationSession(opts: {
  gateId: string;
  participantIds: string[];
  configJson?: string;
  deadlineAt?: string;
}) {
  const db = getDb();
  const id = createId();
  const ts = now();
  db.insert(schema.negotiationSessions).values({
    id,
    gateId: opts.gateId,
    status: "OPEN",
    currentRound: 0,
    configJson: opts.configJson ?? "{}",
    roundStartedAt: null,
    deadlineAt: opts.deadlineAt ?? null,
    resolvedByAgentId: null,
    resolutionSummary: null,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  // Insert participants into join table
  for (const agentId of opts.participantIds) {
    db.insert(schema.negotiationParticipants).values({
      id: createId(),
      sessionId: id,
      agentId,
    }).run();
  }
  return hydrateSession(db, db.select().from(schema.negotiationSessions).where(eq(schema.negotiationSessions.id, id)).get());
}

export function getNegotiationSession(id: string) {
  const db = getDb();
  const row = db.select().from(schema.negotiationSessions).where(eq(schema.negotiationSessions.id, id)).get();
  if (!row) return undefined;
  return hydrateSession(db, row);
}

export function getNegotiationSessionByGate(gateId: string) {
  const db = getDb();
  const row = db.select().from(schema.negotiationSessions).where(eq(schema.negotiationSessions.gateId, gateId)).get();
  if (!row) return undefined;
  return hydrateSession(db, row);
}

export function listNegotiationSessions(opts?: { gateId?: string; status?: string }) {
  const db = getDb();
  let q = db.select().from(schema.negotiationSessions);
  if (opts?.gateId) q = q.where(eq(schema.negotiationSessions.gateId, opts.gateId)) as any;
  if (opts?.status) q = q.where(eq(schema.negotiationSessions.status, opts.status)) as any;
  return q.all().map(row => hydrateSession(db, row));
}

export function updateNegotiationSession(id: string, fields: {
  status?: string;
  currentRound?: number;
  roundStartedAt?: string | null;
  resolvedByAgentId?: string | null;
  resolutionSummary?: string | null;
}) {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (fields.status !== undefined) updates.status = fields.status;
  if (fields.currentRound !== undefined) updates.currentRound = fields.currentRound;
  if (fields.roundStartedAt !== undefined) updates.roundStartedAt = fields.roundStartedAt;
  if (fields.resolvedByAgentId !== undefined) updates.resolvedByAgentId = fields.resolvedByAgentId;
  if (fields.resolutionSummary !== undefined) updates.resolutionSummary = fields.resolutionSummary;
  db.update(schema.negotiationSessions).set(updates).where(eq(schema.negotiationSessions.id, id)).run();
  return getNegotiationSession(id)!;
}

// ── Message CRUD ─────────────────────────────────────

export function createNegotiationMessage(opts: {
  sessionId: string;
  agentId: string;
  round: number;
  kind: string;
  content: string;
}) {
  const db = getDb();
  const id = createId();
  const row = {
    id,
    sessionId: opts.sessionId,
    agentId: opts.agentId,
    round: opts.round,
    kind: opts.kind,
    content: opts.content,
    createdAt: now(),
  };
  db.insert(schema.negotiationMessages).values(row).run();
  return row;
}

export function listNegotiationMessages(sessionId: string) {
  const db = getDb();
  return db.select().from(schema.negotiationMessages)
    .where(eq(schema.negotiationMessages.sessionId, sessionId))
    .all();
}
