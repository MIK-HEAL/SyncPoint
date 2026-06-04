import { and, desc, eq, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import {
  ProjectMemoryStatus,
  computeMemoryFingerprint,
  defaultKindFromCategory,
  ValidityStatus,
  MemorySeverity,
} from "syncpoint-context";
import type { ProjectMemory, MemoryDedupResult } from "syncpoint-context";
import { getRawDb } from "../db.js";
import { _getDb } from "./_shared.js";
import {
  buildFtsQuery,
  type CollectedMemory,
  type ProjectMemoryRow,
  hydrateProjectMemories,
} from "./project-memory-repository-internals.js";

export type { CollectedMemory } from "./project-memory-repository-internals.js";

export function checkMemoryDuplicate(category: string, title: string, content: string): MemoryDedupResult {
  const fp = computeMemoryFingerprint(category, title, content);
  const db = _getDb();
  const matchingVersions = db.select().from(s.projectMemoryVersions)
    .where(eq(s.projectMemoryVersions.fingerprint, fp))
    .all();
  if (matchingVersions.length === 0) {
    return { isDuplicate: false, fingerprint: fp };
  }
  const matchingIds = matchingVersions.map(row => row.memoryId);
  const existing = db.select().from(s.projectMemories)
    .where(inArray(s.projectMemories.id, matchingIds))
    .all()
    .filter(row => row.status !== ProjectMemoryStatus.DEPRECATED);
  if (existing.length > 0) {
    return { isDuplicate: true, existingId: existing[0]!.id, fingerprint: fp };
  }
  return { isDuplicate: false, fingerprint: fp };
}

export function getProjectMemory(id: string): ProjectMemory {
  const db = _getDb();
  const row = db.select().from(s.projectMemories).where(eq(s.projectMemories.id, id)).get();
  if (!row) throw new Error(`project_memory not found: ${id}`);
  return hydrateProjectMemories([row])[0]!;
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

  const rows = conditions.length === 0
    ? db.select().from(s.projectMemories).orderBy(desc(s.projectMemories.updatedAt)).all()
    : conditions.length === 1
      ? db.select().from(s.projectMemories).where(conditions[0]).orderBy(desc(s.projectMemories.updatedAt)).all()
      : db.select().from(s.projectMemories).where(and(...conditions)).orderBy(desc(s.projectMemories.updatedAt)).all();

  return hydrateProjectMemories(rows);
}

export function searchProjectMemories(query: string): ProjectMemory[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const ftsQuery = buildFtsQuery(trimmed);
  const raw = getRawDb();
  let ids: string[] = [];
  if (ftsQuery) {
    try {
      ids = (raw.prepare(
        "SELECT memory_id AS memoryId FROM project_memory_fts WHERE project_memory_fts MATCH ?",
      ).all(ftsQuery) as Array<{ memoryId: string }>).map(row => row.memoryId);
    } catch {
      ids = [];
    }
  }

  const db = _getDb();
  const approvedRows = db.select().from(s.projectMemories)
    .where(eq(s.projectMemories.status, ProjectMemoryStatus.APPROVED))
    .orderBy(desc(s.projectMemories.updatedAt))
    .all();

  if (ids.length === 0) {
    return hydrateProjectMemories(approvedRows).filter(memory =>
      memory.title.toLowerCase().includes(trimmed.toLowerCase())
      || memory.content.toLowerCase().includes(trimmed.toLowerCase())
      || memory.tags.some(tag => tag.toLowerCase().includes(trimmed.toLowerCase()))
    );
  }

  const byId = new Map(approvedRows.map(row => [row.id, row]));
  const matchedRows = ids
    .map(id => byId.get(id))
    .filter((row): row is ProjectMemoryRow => Boolean(row));
  return hydrateProjectMemories(matchedRows);
}

export function collectProjectMemories(taskId?: string): CollectedMemory[] {
  const approved = listProjectMemories({ status: ProjectMemoryStatus.APPROVED });

  const active = approved.filter(m => !m.supersededBy);

  const seen = new Map<string, ProjectMemory>();
  for (const m of active) {
    const fp = m.fingerprint || computeMemoryFingerprint(m.category, m.title, m.content);
    if (!seen.has(fp)) {
      seen.set(fp, m);
    }
  }
  const deduped = [...seen.values()];

  const alwaysCategories = new Set(["overview", "architecture", "convention"]);
  const always = deduped.filter(m => m.scope === "project" && alwaysCategories.has(m.category));

  const taskRelevant = taskId
    ? deduped.filter(m => m.scope === "task" && m.taskId === taskId)
    : [];

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
    kind: m.kind || defaultKindFromCategory(m.category),
    projectionTarget: m.projectionTarget ?? null,
    appliesTo: m.appliesTo || {},
    severity: m.severity || MemorySeverity.INFO,
    validityStatus: m.validityStatus || ValidityStatus.FRESH,
    validatorType: m.validatorType || "",
    validatorConfig: m.validatorConfig ?? null,
  }));
}
