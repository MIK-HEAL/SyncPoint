/**
 * Negotiation Repository — CRUD for negotiation sessions, participants, and messages.
 */

import { eq } from "drizzle-orm";
import { parseNegotiationConfig } from "syncpoint-core";
import type { NegotiationMessage, NegotiationSession } from "syncpoint-core";
import * as schema from "../schema.js";
import { _getDb, createId, now } from "./_shared.js";

function hydrateSession(db: ReturnType<typeof _getDb>, row: typeof schema.negotiationSessions.$inferSelect): NegotiationSession {
  const parts = db.select().from(schema.negotiationParticipants)
    .where(eq(schema.negotiationParticipants.sessionId, row.id)).all();

  return {
    id: row.id,
    gateId: row.gateId,
    participantIds: parts.map(p => p.agentId),
    status: row.status as NegotiationSession["status"],
    currentRound: row.currentRound,
    config: parseNegotiationConfig(row.configJson),
    roundStartedAt: row.roundStartedAt,
    deadlineAt: row.deadlineAt,
    resolvedByAgentId: row.resolvedByAgentId,
    resolutionSummary: row.resolutionSummary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as NegotiationSession;
}

// ── Session CRUD ─────────────────────────────────────

export function createNegotiationSession(opts: {
  gateId: string;
  participantIds: string[];
  configJson?: string;
  deadlineAt?: string;
}): NegotiationSession {
  const db = _getDb();
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
  const row = db.select().from(schema.negotiationSessions).where(eq(schema.negotiationSessions.id, id)).get();
  if (!row) {
    throw new Error(`negotiation session not found after create: ${id}`);
  }
  return hydrateSession(db, row);
}

export function getNegotiationSession(id: string): NegotiationSession | undefined {
  const db = _getDb();
  const row = db.select().from(schema.negotiationSessions).where(eq(schema.negotiationSessions.id, id)).get();
  if (!row) return undefined;
  return hydrateSession(db, row);
}

export function getNegotiationSessionByGate(gateId: string): NegotiationSession | undefined {
  const db = _getDb();
  const row = db.select().from(schema.negotiationSessions).where(eq(schema.negotiationSessions.gateId, gateId)).get();
  if (!row) return undefined;
  return hydrateSession(db, row);
}

export function listNegotiationSessions(opts?: { gateId?: string; status?: string }): NegotiationSession[] {
  const db = _getDb();
  const rows = db.select().from(schema.negotiationSessions).all().filter((row: typeof schema.negotiationSessions.$inferSelect) => {
    if (opts?.gateId && row.gateId !== opts.gateId) return false;
    if (opts?.status && row.status !== opts.status) return false;
    return true;
  });

  return rows.map((row: typeof schema.negotiationSessions.$inferSelect) => hydrateSession(db, row));
}

export function updateNegotiationSession(id: string, fields: {
  status?: string;
  currentRound?: number;
  roundStartedAt?: string | null;
  resolvedByAgentId?: string | null;
  resolutionSummary?: string | null;
}): NegotiationSession {
  const db = _getDb();
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
}): NegotiationMessage {
  const db = _getDb();
  const id = createId();
  const row = {
    id,
    sessionId: opts.sessionId,
    agentId: opts.agentId,
    round: opts.round,
    kind: opts.kind as NegotiationMessage["kind"],
    content: opts.content,
    createdAt: now(),
  };
  db.insert(schema.negotiationMessages).values(row).run();
  return row as NegotiationMessage;
}

export function listNegotiationMessages(sessionId: string): NegotiationMessage[] {
  const db = _getDb();
  return db.select().from(schema.negotiationMessages)
    .where(eq(schema.negotiationMessages.sessionId, sessionId))
    .all()
    .sort(
      (a: typeof schema.negotiationMessages.$inferSelect, b: typeof schema.negotiationMessages.$inferSelect) =>
        a.createdAt.localeCompare(b.createdAt),
    ) as NegotiationMessage[];
}
