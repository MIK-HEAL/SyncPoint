/**
 * State Transition Log repository — Drizzle typed queries for the state_transition_log table.
 *
 * All SQL is expressed through the Drizzle schema (schema/runtime.ts stateTransitionLog),
 * ensuring column names stay in sync with the schema definition.
 */

import { eq, desc, and, sql } from "drizzle-orm";
import * as s from "../schema.js";
import { _getDb, now, createId } from "./_shared.js";

// ── Types ────────────────────────────────────────────────

export interface StateTransitionRow {
  entityType: string;
  entityId: string;
  fromState: string;
  toState: string;
  operation: string;
  agentId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// ── Write ────────────────────────────────────────────────

/**
 * Insert a state transition log record.
 * Returns the generated id.
 */
export function insertTransitionLog(record: {
  entityType: string;
  entityId: string;
  fromState: string;
  toState: string;
  operation: string;
  agentId: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}): string {
  const db = _getDb();
  const id = createId();
  const ts = record.createdAt ?? now();
  db.insert(s.stateTransitionLog).values({
    id,
    entityType: record.entityType,
    entityId: record.entityId,
    fromState: record.fromState,
    toState: record.toState,
    operation: record.operation,
    agentId: record.agentId,
    payloadJson: record.payload ? JSON.stringify(record.payload) : "{}",
    createdAt: ts,
  }).run();
  return id;
}

// ── Read ─────────────────────────────────────────────────

/**
 * Get the transition history for an entity, newest first.
 */
export function getEntityTransitionHistory(
  entityType: string,
  entityId: string,
  limit = 50,
): StateTransitionRow[] {
  const db = _getDb();
  const rows = db.select({
    entityType: s.stateTransitionLog.entityType,
    entityId: s.stateTransitionLog.entityId,
    fromState: s.stateTransitionLog.fromState,
    toState: s.stateTransitionLog.toState,
    operation: s.stateTransitionLog.operation,
    agentId: s.stateTransitionLog.agentId,
    payloadJson: s.stateTransitionLog.payloadJson,
    createdAt: s.stateTransitionLog.createdAt,
  })
    .from(s.stateTransitionLog)
    .where(and(
      eq(s.stateTransitionLog.entityType, entityType),
      eq(s.stateTransitionLog.entityId, entityId),
    ))
    .orderBy(desc(s.stateTransitionLog.createdAt))
    .limit(limit)
    .all();

  return rows.map(r => ({
    entityType: r.entityType,
    entityId: r.entityId,
    fromState: r.fromState,
    toState: r.toState,
    operation: r.operation,
    agentId: r.agentId,
    payload: safeParseJson(r.payloadJson),
    createdAt: r.createdAt,
  }));
}

/**
 * Find all entities currently in a non-terminal (intermediate) state,
 * based on the latest transition log entry for each entity.
 *
 * Note: This queries the transition log, not the entity tables directly.
 * For more reliable state detection, prefer querying entity tables directly
 * (e.g. SELECT id, status FROM resource_claim WHERE status NOT IN (...)).
 */
export function findIntermediateStateEntitiesFromLog(
  entityType: string,
  terminalStates: string[],
): Array<{ entityId: string; state: string }> {
  const db = _getDb();
  // Subquery: latest transition per entity of this type
  const latest = db.select({
    entityId: s.stateTransitionLog.entityId,
    maxCreated: sql<string>`MAX(${s.stateTransitionLog.createdAt})`.as("max_created"),
  })
    .from(s.stateTransitionLog)
    .where(eq(s.stateTransitionLog.entityType, entityType))
    .groupBy(s.stateTransitionLog.entityId)
    .as("latest");

  // Main query: join to get the to_state of the latest transition
  const rows = db.select({
    entityId: s.stateTransitionLog.entityId,
    state: s.stateTransitionLog.toState,
  })
    .from(s.stateTransitionLog)
    .innerJoin(latest, and(
      eq(s.stateTransitionLog.entityId, latest.entityId),
      eq(s.stateTransitionLog.createdAt, latest.maxCreated),
    ))
    .where(eq(s.stateTransitionLog.entityType, entityType))
    .all();

  return rows
    .filter(r => !terminalStates.includes(r.state))
    .map(r => ({ entityId: r.entityId, state: r.state }));
}

// ── Helpers ──────────────────────────────────────────────

function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
