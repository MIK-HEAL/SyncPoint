/**
 * PinnedMemory repository.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import type { PinnedMemory, PinnedMemoryCreate } from "syncpoint-core";
import { _getDb, now, createId, NotFoundError } from "./_shared.js";

export function createPinnedMemory(data: PinnedMemoryCreate): PinnedMemory {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.pinnedMemories).values({
    id,
    key: data.key,
    content: data.content,
    scope: data.scope ?? "project",
    taskId: data.taskId ?? null,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return db.select().from(s.pinnedMemories).where(eq(s.pinnedMemories.id, id)).get() as unknown as PinnedMemory;
}

export function getPinnedMemory(id: string): PinnedMemory {
  const row = _getDb().select().from(s.pinnedMemories).where(eq(s.pinnedMemories.id, id)).get() as unknown as PinnedMemory | undefined;
  if (!row) throw new NotFoundError("pinnedMemory", id);
  return row;
}

export function getPinnedMemoryByKey(key: string): PinnedMemory | undefined {
  return _getDb().select().from(s.pinnedMemories).where(eq(s.pinnedMemories.key, key)).get() as unknown as PinnedMemory | undefined;
}

export function listPinnedMemories(scope?: string, taskId?: string): PinnedMemory[] {
  const db = _getDb();
  let q = db.select().from(s.pinnedMemories);
  if (scope && taskId) {
    return q.where(and(eq(s.pinnedMemories.scope, scope), eq(s.pinnedMemories.taskId, taskId))).all() as unknown as PinnedMemory[];
  }
  if (scope) {
    return q.where(eq(s.pinnedMemories.scope, scope)).all() as unknown as PinnedMemory[];
  }
  return q.all() as unknown as PinnedMemory[];
}

export function updatePinnedMemory(id: string, content: string): PinnedMemory {
  const db = _getDb();
  const existing = getPinnedMemory(id);
  db.update(s.pinnedMemories).set({ content, updatedAt: now() }).where(eq(s.pinnedMemories.id, id)).run();
  return getPinnedMemory(id);
}

export function deletePinnedMemory(id: string): void {
  _getDb().delete(s.pinnedMemories).where(eq(s.pinnedMemories.id, id)).run();
}

/**
 * Collect relevant pinned memories for a resume context.
 * Returns global + project-scoped + task-scoped memories.
 */
export function collectPinnedMemories(taskId: string): Array<{ key: string; content: string }> {
  const db = _getDb();
  const global = db.select().from(s.pinnedMemories)
    .where(eq(s.pinnedMemories.scope, "global")).all() as unknown as PinnedMemory[];
  const project = db.select().from(s.pinnedMemories)
    .where(eq(s.pinnedMemories.scope, "project")).all() as unknown as PinnedMemory[];
  const taskScoped = db.select().from(s.pinnedMemories)
    .where(and(eq(s.pinnedMemories.scope, "task"), eq(s.pinnedMemories.taskId, taskId)))
    .all() as unknown as PinnedMemory[];
  return [...global, ...project, ...taskScoped].map(m => ({ key: m.key, content: m.content }));
}
