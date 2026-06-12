/**
 * Handoff repository.
 */

import { and, desc, eq } from "drizzle-orm";
import * as s from "../schema.js";
import { InvalidStateTransitionError, ResourceNotFoundError } from "syncpoint-kernel";
import { HandoffStatus } from "syncpoint-adapters";
import { EventType } from "syncpoint-kernel";
import type { Handoff, HandoffCreate } from "syncpoint-adapters";
import { _getDb, now, createId, logEvent, NotFoundError } from "./_shared.js";
import { getTask } from "./task-repository.js";
import { getAgent } from "./agent-repository.js";

export function createHandoff(data: HandoffCreate): Handoff {
  getTask(data.taskId);
  getAgent(data.fromAgentId);
  getAgent(data.toAgentId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.handoffs).values({
    id,
    fromAgentId: data.fromAgentId,
    toAgentId: data.toAgentId,
    taskId: data.taskId,
    contextSummary: data.contextSummary,
    status: HandoffStatus.PENDING,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  logEvent(EventType.HANDOFF_INITIATED, "handoff", id);
  return db.select().from(s.handoffs).where(eq(s.handoffs.id, id)).get() as unknown as Handoff;
}

export function acceptHandoff(id: string): Handoff {
  const db = _getDb();
  const h = db.select().from(s.handoffs).where(eq(s.handoffs.id, id)).get() as unknown as Handoff | undefined;
  if (!h) throw new NotFoundError("handoff", id);
  if (h.status !== HandoffStatus.PENDING) throw new InvalidStateTransitionError("handoff", h.status, HandoffStatus.PENDING);
  db.update(s.handoffs).set({ status: HandoffStatus.ACCEPTED, updatedAt: now() }).where(eq(s.handoffs.id, id)).run();
  db.update(s.tasks).set({ ownerAgentId: h.toAgentId, updatedAt: now() }).where(eq(s.tasks.id, h.taskId)).run();
  db.update(s.agents).set({ currentTaskId: null, updatedAt: now() }).where(eq(s.agents.id, h.fromAgentId)).run();
  db.update(s.agents).set({ currentTaskId: h.taskId, updatedAt: now() }).where(eq(s.agents.id, h.toAgentId)).run();
  logEvent(EventType.HANDOFF_ACCEPTED, "handoff", id);
  return db.select().from(s.handoffs).where(eq(s.handoffs.id, id)).get() as unknown as Handoff;
}

export function rejectHandoff(id: string): Handoff {
  const db = _getDb();
  const h = db.select().from(s.handoffs).where(eq(s.handoffs.id, id)).get() as unknown as Handoff | undefined;
  if (!h) throw new NotFoundError("handoff", id);
  if (h.status !== HandoffStatus.PENDING) throw new InvalidStateTransitionError("handoff", h.status, HandoffStatus.PENDING);
  db.update(s.handoffs).set({ status: HandoffStatus.REJECTED, updatedAt: now() }).where(eq(s.handoffs.id, id)).run();
  logEvent(EventType.HANDOFF_REJECTED, "handoff", id);
  return db.select().from(s.handoffs).where(eq(s.handoffs.id, id)).get() as unknown as Handoff;
}

export function listHandoffs(): Handoff[] {
  return _getDb().select().from(s.handoffs)
    .orderBy(desc(s.handoffs.createdAt))
    .all() as unknown as Handoff[];
}

export function listPendingHandoffs(): Handoff[] {
  return _getDb().select().from(s.handoffs)
    .where(eq(s.handoffs.status, HandoffStatus.PENDING))
    .orderBy(desc(s.handoffs.createdAt))
    .all() as unknown as Handoff[];
}

export function getLatestHandoffForReceiver(taskId: string, toAgentId: string): Handoff | undefined {
  return _getDb().select().from(s.handoffs)
    .where(and(eq(s.handoffs.taskId, taskId), eq(s.handoffs.toAgentId, toAgentId)))
    .orderBy(desc(s.handoffs.createdAt))
    .limit(1)
    .get() as unknown as Handoff | undefined;
}
