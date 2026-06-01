/**
 * ContextSnapshot repository.
 *
 * Uses the normalized context_snapshot + context_snapshot_resource tables.
 */

import { eq, and, desc } from "drizzle-orm";
import * as s from "../schema.js";
import { EventType } from "syncpoint-core";
import type { ContextSnapshot, ContextSnapshotCreate } from "syncpoint-core";
import { _getDb, now, createId, logEvent } from "./_shared.js";
import { getTask } from "./task-repository.js";
import { getAgent } from "./agent-repository.js";

// ── Internal helpers ────────────────────────────────

function rowToSnapshot(row: any): ContextSnapshot {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    checkpointId: row.checkpointId,
    kind: row.kind ?? "resume",
    summary: row.summary ?? "",
    payload: row.payloadJson ?? {},
    validationStatus: "",
    staleReason: "",
    createdAt: row.createdAt,
  } as ContextSnapshot;
}

// ── CRUD ────────────────────────────────────────────

export function createContextSnapshot(data: ContextSnapshotCreate): ContextSnapshot {
  getTask(data.taskId);
  getAgent(data.agentId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.contextSnapshots).values({
    id,
    taskId: data.taskId,
    agentId: data.agentId,
    checkpointId: data.checkpointId ?? "",
    kind: data.kind ?? "resume",
    summary: data.summary ?? "",
    payloadJson: data.payload ?? {},
    createdAt: ts,
  }).run();
  logEvent(EventType.CONTEXT_SNAPSHOT_CREATED, "context_snapshot", id);
  const row = db.select().from(s.contextSnapshots).where(eq(s.contextSnapshots.id, id)).get();
  return rowToSnapshot(row);
}

export function listContextSnapshots(taskId: string): ContextSnapshot[] {
  getTask(taskId);
  return _getDb().select().from(s.contextSnapshots)
    .where(eq(s.contextSnapshots.taskId, taskId))
    .all()
    .map(rowToSnapshot);
}

export function getLatestContextSnapshot(taskId: string, agentId: string): ContextSnapshot | undefined {
  const row = _getDb().select().from(s.contextSnapshots)
    .where(and(eq(s.contextSnapshots.taskId, taskId), eq(s.contextSnapshots.agentId, agentId)))
    .orderBy(desc(s.contextSnapshots.createdAt))
    .limit(1)
    .get();
  return row ? rowToSnapshot(row) : undefined;
}
