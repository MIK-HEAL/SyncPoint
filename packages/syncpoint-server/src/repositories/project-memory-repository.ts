/**
 * Project Memory — long-lived project knowledge CRUD.
 */

import { eq, and, like, desc, sql } from "drizzle-orm";
import * as s from "../schema.js";
import {
  EventType,
  ProjectMemoryStatus,
  computeMemoryFingerprint,
  defaultKindFromCategory,
  MemoryKind,
  ValidityStatus,
  MemorySeverity,
} from "syncpoint-core";
import type {
  ProjectMemory,
  ProjectMemoryCreate,
  MemoryDedupResult,
} from "syncpoint-core";
import { _getDb, createId, now, logEvent } from "./_shared.js";

/**
 * Check for duplicate fingerprint among non-deprecated memories.
 */
export function checkMemoryDuplicate(category: string, title: string, content: string): MemoryDedupResult {
  const fp = computeMemoryFingerprint(category, title, content);
  const db = _getDb();
  const existing = db.select().from(s.projectMemories)
    .where(eq(s.projectMemories.fingerprint, fp))
    .all()
    .filter((r: any) => r.status !== ProjectMemoryStatus.DEPRECATED);
  if (existing.length > 0) {
    return { isDuplicate: true, existingId: (existing[0] as any).id, fingerprint: fp };
  }
  return { isDuplicate: false, fingerprint: fp };
}

export function createProjectMemory(data: ProjectMemoryCreate): ProjectMemory {
  const db = _getDb();
  const id = createId();
  const ts = now();
  const fp = computeMemoryFingerprint(data.category, data.title, data.content);
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
    fingerprint: fp,
    // V2 fields
    kind: data.kind ?? defaultKindFromCategory(data.category),
    projectionTarget: data.projectionTarget ?? null,
    appliesTo: data.appliesTo ? JSON.stringify(data.appliesTo) : "",
    severity: data.severity ?? MemorySeverity.INFO,
    validityStatus: data.validity?.status ?? ValidityStatus.FRESH,
    validityStaleReason: data.validity?.staleReason ?? "",
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

export function updateProjectMemory(id: string, fields: {
  title?: string;
  content?: string;
  tags?: string;
  confidence?: string;
  updatedBy?: string;
  // V2
  kind?: string;
  projectionTarget?: string | null;
  appliesTo?: string;
  severity?: string;
  validityStatus?: string;
  validityStaleReason?: string;
}): ProjectMemory {
  const db = _getDb();
  const existing = getProjectMemory(id);
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.content !== undefined) updates.content = fields.content;
  if (fields.tags !== undefined) updates.tags = fields.tags;
  if (fields.confidence !== undefined) updates.confidence = fields.confidence;
  if (fields.updatedBy !== undefined) updates.updatedBy = fields.updatedBy;
  // Recompute fingerprint if title or content changed
  if (fields.title !== undefined || fields.content !== undefined) {
    const newTitle = fields.title ?? existing.title;
    const newContent = fields.content ?? existing.content;
    updates.fingerprint = computeMemoryFingerprint(existing.category, newTitle, newContent);
  }
  // V2 fields
  if (fields.kind !== undefined) updates.kind = fields.kind;
  if (fields.projectionTarget !== undefined) updates.projectionTarget = fields.projectionTarget;
  if (fields.appliesTo !== undefined) updates.appliesTo = fields.appliesTo;
  if (fields.severity !== undefined) updates.severity = fields.severity;
  if (fields.validityStatus !== undefined) updates.validityStatus = fields.validityStatus;
  if (fields.validityStaleReason !== undefined) updates.validityStaleReason = fields.validityStaleReason;
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
  bumpMemoryVersion();
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
  bumpMemoryVersion();
  logEvent(EventType.PROJECT_MEMORY_DEPRECATED, "project_memory", id);
  return getProjectMemory(id);
}

// ── Supersedes ─────────────────────────────────────

/**
 * Mark `newId` as superseding `oldId`.
 * Sets supersedes on new, supersededBy on old, and deprecates old.
 */
export function supersedeProjectMemory(newId: string, oldId: string, updatedBy: string): { newMem: ProjectMemory; oldMem: ProjectMemory } {
  const db = _getDb();
  const newMem = getProjectMemory(newId);
  const oldMem = getProjectMemory(oldId);
  if (oldMem.status === ProjectMemoryStatus.DEPRECATED && oldMem.supersededBy) {
    throw new Error(`Memory ${oldId} is already superseded by ${oldMem.supersededBy}`);
  }
  const ts = now();
  db.update(s.projectMemories).set({
    supersedes: oldId,
    updatedBy,
    updatedAt: ts,
  }).where(eq(s.projectMemories.id, newId)).run();
  db.update(s.projectMemories).set({
    supersededBy: newId,
    status: ProjectMemoryStatus.DEPRECATED,
    updatedBy,
    updatedAt: ts,
  }).where(eq(s.projectMemories.id, oldId)).run();
  bumpMemoryVersion();
  logEvent(EventType.PROJECT_MEMORY_DEPRECATED, "project_memory", oldId, `superseded by ${newId}`);
  return { newMem: getProjectMemory(newId), oldMem: getProjectMemory(oldId) };
}

// ── Memory Version ────────────────────────────────

/**
 * Get the current memory version counter.
 */
export function getMemoryVersion(): number {
  const db = _getDb();
  const row = db.get<{ version: number }>(sql`SELECT version FROM memory_version WHERE id = 1`);
  return row?.version ?? 0;
}

/**
 * Increment the memory version counter. Called on approve, deprecate, supersede.
 */
export function bumpMemoryVersion(): number {
  const db = _getDb();
  db.run(sql`UPDATE memory_version SET version = version + 1 WHERE id = 1`);
  return getMemoryVersion();
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
 * Collect approved project memories for context injection.
 * P1 upgrade: deduplicates by fingerprint, excludes superseded,
 * returns canonical set ordered by priority (always-include first).
 */
export interface CollectedMemory {
  id: string;
  category: string;
  title: string;
  content: string;
  fingerprint: string;
  // V2
  kind: string;
  projectionTarget: string | null;
  appliesTo: string;
  severity: string;
  validityStatus: string;
}

export function collectProjectMemories(taskId?: string): CollectedMemory[] {
  const db = _getDb();
  const approved = db.select().from(s.projectMemories)
    .where(eq(s.projectMemories.status, ProjectMemoryStatus.APPROVED))
    .orderBy(desc(s.projectMemories.updatedAt))
    .all() as unknown as ProjectMemory[];

  // Exclude superseded (has supersededBy and is still somehow approved — belt and suspenders)
  const active = approved.filter(m => !m.supersededBy);

  // Deduplicate by fingerprint — keep the most recently updated
  const seen = new Map<string, ProjectMemory>();
  for (const m of active) {
    const fp = m.fingerprint || computeMemoryFingerprint(m.category, m.title, m.content);
    if (!seen.has(fp)) {
      seen.set(fp, m);
    }
    // already seen → skip (active is ordered by updatedAt desc, so first wins)
  }
  const deduped = [...seen.values()];

  // Always include: project-scope overview, architecture, convention
  const alwaysCategories = new Set(["overview", "architecture", "convention"]);
  const always = deduped.filter(m => m.scope === "project" && alwaysCategories.has(m.category));

  // Task-relevant: task-scoped memories matching taskId
  const taskRelevant = taskId
    ? deduped.filter(m => m.scope === "task" && m.taskId === taskId)
    : [];

  // Domain/other approved (not already included)
  const alwaysIds = new Set(always.map(m => m.id));
  const taskIds = new Set(taskRelevant.map(m => m.id));
  const other = deduped.filter(m =>
    !alwaysIds.has(m.id) && !taskIds.has(m.id) && m.scope !== "task"
  );

  return [...always, ...taskRelevant, ...other].map(m => ({
    id: m.id,
    category: m.category,
    title: m.title,
    content: m.content,
    fingerprint: m.fingerprint || computeMemoryFingerprint(m.category, m.title, m.content),
    // V2 — pass through, with backward-compat defaults
    kind: m.kind || defaultKindFromCategory(m.category),
    projectionTarget: m.projectionTarget ?? null,
    appliesTo: m.appliesTo || "",
    severity: m.severity || MemorySeverity.INFO,
    validityStatus: m.validityStatus || ValidityStatus.FRESH,
  }));
}
