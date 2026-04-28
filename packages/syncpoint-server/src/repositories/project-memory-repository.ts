/**
 * Project Memory — long-lived project knowledge CRUD.
 */

import { eq, and, like, desc } from "drizzle-orm";
import * as s from "../schema.js";
import {
  EventType,
  ProjectMemoryStatus,
} from "syncpoint-core";
import type {
  ProjectMemory,
  ProjectMemoryCreate,
} from "syncpoint-core";
import { _getDb, createId, now, logEvent } from "./_shared.js";

export function createProjectMemory(data: ProjectMemoryCreate): ProjectMemory {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.projectMemories).values({
    id,
    scope: data.scope ?? "project",
    category: data.category,
    title: data.title,
    content: data.content,
    tags: data.tags ?? "",
    sourceType: data.sourceType ?? "human",
    sourceRef: data.sourceRef ?? "",
    status: ProjectMemoryStatus.DRAFT,
    confidence: data.confidence ?? "medium",
    taskId: data.taskId ?? null,
    createdBy: data.createdBy ?? "",
    updatedBy: data.createdBy ?? "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  logEvent(EventType.PROJECT_MEMORY_CREATED, "project_memory", id, data.category);
  return getProjectMemory(id);
}

export function getProjectMemory(id: string): ProjectMemory {
  const db = _getDb();
  const row = db.select().from(s.projectMemories).where(eq(s.projectMemories.id, id)).get();
  if (!row) throw new Error(`project_memory not found: ${id}`);
  return row as unknown as ProjectMemory;
}

export function updateProjectMemory(id: string, fields: { title?: string; content?: string; tags?: string; confidence?: string; updatedBy?: string }): ProjectMemory {
  const db = _getDb();
  getProjectMemory(id); // ensure exists
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.content !== undefined) updates.content = fields.content;
  if (fields.tags !== undefined) updates.tags = fields.tags;
  if (fields.confidence !== undefined) updates.confidence = fields.confidence;
  if (fields.updatedBy !== undefined) updates.updatedBy = fields.updatedBy;
  db.update(s.projectMemories).set(updates).where(eq(s.projectMemories.id, id)).run();
  logEvent(EventType.PROJECT_MEMORY_UPDATED, "project_memory", id);
  return getProjectMemory(id);
}

export function approveProjectMemory(id: string, updatedBy = ""): ProjectMemory {
  const mem = getProjectMemory(id);
  if (mem.status === ProjectMemoryStatus.DEPRECATED) {
    throw new Error(`Cannot approve deprecated project memory ${id}`);
  }
  _getDb().update(s.projectMemories).set({
    status: ProjectMemoryStatus.APPROVED,
    updatedBy,
    updatedAt: now(),
  }).where(eq(s.projectMemories.id, id)).run();
  logEvent(EventType.PROJECT_MEMORY_APPROVED, "project_memory", id);
  return getProjectMemory(id);
}

export function deprecateProjectMemory(id: string, updatedBy = ""): ProjectMemory {
  getProjectMemory(id); // ensure exists
  _getDb().update(s.projectMemories).set({
    status: ProjectMemoryStatus.DEPRECATED,
    updatedBy,
    updatedAt: now(),
  }).where(eq(s.projectMemories.id, id)).run();
  logEvent(EventType.PROJECT_MEMORY_DEPRECATED, "project_memory", id);
  return getProjectMemory(id);
}

export function listProjectMemories(filters?: {
  status?: string;
  category?: string;
  scope?: string;
  taskId?: string;
}): ProjectMemory[] {
  const db = _getDb();
  const conditions = [];
  if (filters?.status) conditions.push(eq(s.projectMemories.status, filters.status));
  if (filters?.category) conditions.push(eq(s.projectMemories.category, filters.category));
  if (filters?.scope) conditions.push(eq(s.projectMemories.scope, filters.scope));
  if (filters?.taskId) conditions.push(eq(s.projectMemories.taskId, filters.taskId));

  if (conditions.length === 0) {
    return db.select().from(s.projectMemories)
      .orderBy(desc(s.projectMemories.updatedAt))
      .all() as unknown as ProjectMemory[];
  }
  if (conditions.length === 1) {
    return db.select().from(s.projectMemories)
      .where(conditions[0])
      .orderBy(desc(s.projectMemories.updatedAt))
      .all() as unknown as ProjectMemory[];
  }
  return db.select().from(s.projectMemories)
    .where(and(...conditions))
    .orderBy(desc(s.projectMemories.updatedAt))
    .all() as unknown as ProjectMemory[];
}

export function searchProjectMemories(query: string): ProjectMemory[] {
  const db = _getDb();
  const pattern = `%${query}%`;
  // Search across title, content, and tags
  return db.select().from(s.projectMemories)
    .where(
      and(
        // Exclude deprecated by default
        eq(s.projectMemories.status, ProjectMemoryStatus.APPROVED),
      )
    )
    .all()
    .filter((row: any) =>
      row.title.toLowerCase().includes(query.toLowerCase()) ||
      row.content.toLowerCase().includes(query.toLowerCase()) ||
      row.tags.toLowerCase().includes(query.toLowerCase())
    ) as unknown as ProjectMemory[];
}

/**
 * Collect approved project memories for resume context injection.
 * Returns "always include" (project-scope overview/architecture/convention)
 * plus task-relevant memories if taskId provided.
 */
export function collectProjectMemories(taskId?: string): Array<{ id: string; category: string; title: string; content: string }> {
  const db = _getDb();
  const approved = db.select().from(s.projectMemories)
    .where(eq(s.projectMemories.status, ProjectMemoryStatus.APPROVED))
    .orderBy(desc(s.projectMemories.updatedAt))
    .all() as unknown as ProjectMemory[];

  // Always include: project-scope overview, architecture, convention
  const alwaysCategories = new Set(["overview", "architecture", "convention"]);
  const always = approved.filter(m => m.scope === "project" && alwaysCategories.has(m.category));

  // Task-relevant: task-scoped memories matching taskId
  const taskRelevant = taskId
    ? approved.filter(m => m.scope === "task" && m.taskId === taskId)
    : [];

  // Domain/other approved (not already included)
  const alwaysIds = new Set(always.map(m => m.id));
  const taskIds = new Set(taskRelevant.map(m => m.id));
  const other = approved.filter(m =>
    !alwaysIds.has(m.id) && !taskIds.has(m.id) && m.scope !== "task"
  );

  return [...always, ...taskRelevant, ...other].map(m => ({
    id: m.id,
    category: m.category,
    title: m.title,
    content: m.content,
  }));
}
