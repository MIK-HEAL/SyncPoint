/**
 * Wake Request repository — CRUD for wake_request table.
 */

import { eq, and, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import { WakeRequestStatus, validateWakeRequestTransition } from "syncpoint-core";
import type { WakeRequest, WakeRequestCreate } from "syncpoint-core";
import { _getDb, now, createId, NotFoundError } from "./_shared.js";

export function createWakeRequest(data: WakeRequestCreate): WakeRequest {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.wakeRequests).values({
    id,
    sessionId: data.sessionId,
    targetAgentId: data.targetAgentId,
    targetRole: data.targetRole,
    action: data.action,
    reason: data.reason,
    triggerEventType: data.triggerEventType,
    triggerEntityId: data.triggerEntityId,
    taskId: data.taskId ?? null,
    reviewRequestId: data.reviewRequestId ?? null,
    promptHint: data.promptHint ?? "",
    mcpToolHint: data.mcpToolHint ?? "",
    cliHint: data.cliHint ?? "",
    runnerMode: data.runnerMode ?? "manual",
    status: WakeRequestStatus.QUEUED,
    resultSummary: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return getWakeRequest(id);
}

export function getWakeRequest(id: string): WakeRequest {
  const db = _getDb();
  const row = db.select().from(s.wakeRequests).where(eq(s.wakeRequests.id, id)).get();
  if (!row) throw new NotFoundError("wake_request", id);
  return row as unknown as WakeRequest;
}

export function listWakeRequests(sessionId: string): WakeRequest[] {
  const db = _getDb();
  return db.select().from(s.wakeRequests)
    .where(eq(s.wakeRequests.sessionId, sessionId))
    .all() as unknown as WakeRequest[];
}

export function listWakeRequestsByAgent(agentId: string): WakeRequest[] {
  const db = _getDb();
  return db.select().from(s.wakeRequests)
    .where(eq(s.wakeRequests.targetAgentId, agentId))
    .all() as unknown as WakeRequest[];
}

export function listQueuedWakeRequests(sessionId?: string): WakeRequest[] {
  const db = _getDb();
  if (sessionId) {
    return db.select().from(s.wakeRequests)
      .where(and(
        eq(s.wakeRequests.sessionId, sessionId),
        eq(s.wakeRequests.status, WakeRequestStatus.QUEUED),
      ))
      .all() as unknown as WakeRequest[];
  }
  return db.select().from(s.wakeRequests)
    .where(eq(s.wakeRequests.status, WakeRequestStatus.QUEUED))
    .all() as unknown as WakeRequest[];
}

export function updateWakeRequestStatus(
  id: string,
  status: WakeRequestStatus,
  resultSummary?: string,
): WakeRequest {
  const wr = getWakeRequest(id);
  validateWakeRequestTransition(wr.status as WakeRequestStatus, status);
  const db = _getDb();
  const updates: Record<string, unknown> = { status, updatedAt: now() };
  if (resultSummary !== undefined) updates.resultSummary = resultSummary;
  db.update(s.wakeRequests).set(updates).where(eq(s.wakeRequests.id, id)).run();
  return getWakeRequest(id);
}

export function hasActiveWakeForAgent(
  sessionId: string,
  agentId: string,
  action: string,
): boolean {
  const db = _getDb();
  const activeStatuses = [
    WakeRequestStatus.QUEUED,
    WakeRequestStatus.DISPATCHED,
    WakeRequestStatus.RUNNING,
  ];
  const row = db.select().from(s.wakeRequests)
    .where(and(
      eq(s.wakeRequests.sessionId, sessionId),
      eq(s.wakeRequests.targetAgentId, agentId),
      eq(s.wakeRequests.action, action),
      inArray(s.wakeRequests.status, activeStatuses),
    ))
    .get();
  return !!row;
}
