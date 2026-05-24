/**
 * Project Memory — long-lived project knowledge CRUD.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  AppliesTo,
  ProjectMemoryValidatorConfig,
  ProjectMemory,
  ProjectMemoryCreate,
  MemoryDedupResult,
  MemoryProjectionInput,
} from "syncpoint-core";
import { getRawDb } from "../db.js";
import { _getDb, createId, now, logEvent } from "./_shared.js";

type ProjectMemoryRow = typeof s.projectMemories.$inferSelect;
type ProjectMemoryVersionRow = typeof s.projectMemoryVersions.$inferSelect;
type ProjectMemoryProjectionRow = typeof s.projectMemoryProjections.$inferSelect;
type ProjectMemoryValidationRow = typeof s.projectMemoryValidations.$inferSelect;

function normalizeStringList(values?: string[] | null): string[] {
  return [...new Set((values ?? []).map(v => v.trim()).filter(Boolean))];
}

function normalizeTags(tags?: string[] | null): string[] {
  return normalizeStringList(tags);
}

function normalizeAppliesTo(appliesTo?: AppliesTo | null): AppliesTo {
  if (!appliesTo) return {};
  const normalized: Record<string, string[]> = {};
  for (const [field, patterns] of Object.entries(appliesTo)) {
    const key = field.trim();
    const values = normalizeStringList(patterns);
    if (key && values.length > 0) {
      normalized[key] = values;
    }
  }
  return normalized;
}

function normalizeValidatorConfig(config?: ProjectMemoryValidatorConfig | null): ProjectMemoryValidatorConfig | null {
  if (!config) return null;
  const message = typeof config.message === "string" ? config.message.trim() : undefined;
  const actions = normalizeStringList(config.actions);
  const extraEntries = Object.entries(config).filter(([key]) => key !== "message" && key !== "actions");
  if (!message && actions.length === 0 && extraEntries.length === 0) {
    return null;
  }
  return {
    ...Object.fromEntries(extraEntries),
    message: message || undefined,
    actions: actions.length > 0 ? actions : undefined,
  };
}

function serializeValidatorPayload(config: ProjectMemoryValidatorConfig | null): string {
  if (!config) return "";
  const payload = Object.fromEntries(
    Object.entries(config).filter(([key, value]) => key !== "message" && key !== "actions" && value !== undefined),
  );
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : "";
}

function parseValidatorPayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function buildFtsTagText(tags: string[]): string {
  return tags.join(" ");
}

function buildFtsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu) ?? query.split(/\s+/).filter(Boolean);
  return tokens.map(token => `${token.replace(/"/g, '""')}*`).join(" AND ");
}

function ensureProjectMemoryFtsSchema(): void {
  const raw = getRawDb();
  raw.exec(s.PROJECT_MEMORY_FTS_SQL);
}

function syncProjectMemoryFts(memory: ProjectMemory): void {
  const raw = getRawDb();
  ensureProjectMemoryFtsSchema();
  raw.prepare("DELETE FROM project_memory_fts WHERE memory_id = ?").run(memory.id);
  raw.prepare(
    "INSERT INTO project_memory_fts(memory_id, title, content, category, tags) VALUES (?, ?, ?, ?, ?)",
  ).run(memory.id, memory.title, memory.content, memory.category, buildFtsTagText(memory.tags));
}

function replaceProjectMemoryTags(memoryId: string, tags: string[]): void {
  const db = _getDb();
  db.delete(s.projectMemoryTags).where(eq(s.projectMemoryTags.memoryId, memoryId)).run();
  for (const tag of tags) {
    db.insert(s.projectMemoryTags).values({
      id: createId(),
      memoryId,
      tag,
    }).run();
  }
}

function replaceProjectMemoryScopes(memoryId: string, appliesTo: AppliesTo): void {
  const db = _getDb();
  db.delete(s.projectMemoryScopes).where(eq(s.projectMemoryScopes.memoryId, memoryId)).run();
  for (const [field, patterns] of Object.entries(appliesTo)) {
    for (const pattern of patterns) {
      db.insert(s.projectMemoryScopes).values({
        id: createId(),
        memoryId,
        field,
        pattern,
      }).run();
    }
  }
}

function replaceProjectMemoryValidationActions(memoryId: string, actions: string[]): void {
  const db = _getDb();
  db.delete(s.projectMemoryValidationActions).where(eq(s.projectMemoryValidationActions.memoryId, memoryId)).run();
  for (const action of actions) {
    db.insert(s.projectMemoryValidationActions).values({
      id: createId(),
      memoryId,
      action,
    }).run();
  }
}

function hydrateProjectMemories(rows: ProjectMemoryRow[]): ProjectMemory[] {
  if (rows.length === 0) return [];
  const db = _getDb();
  const ids = rows.map(row => row.id);

  const tagRows = db.select().from(s.projectMemoryTags)
    .where(inArray(s.projectMemoryTags.memoryId, ids))
    .all();
  const versionRows = db.select().from(s.projectMemoryVersions)
    .where(inArray(s.projectMemoryVersions.memoryId, ids))
    .all();
  const projectionRows = db.select().from(s.projectMemoryProjections)
    .where(inArray(s.projectMemoryProjections.memoryId, ids))
    .all();
  const scopeRows = db.select().from(s.projectMemoryScopes)
    .where(inArray(s.projectMemoryScopes.memoryId, ids))
    .all();
  const validationRows = db.select().from(s.projectMemoryValidations)
    .where(inArray(s.projectMemoryValidations.memoryId, ids))
    .all();
  const validationActionRows = db.select().from(s.projectMemoryValidationActions)
    .where(inArray(s.projectMemoryValidationActions.memoryId, ids))
    .all();

  const tagsById = new Map<string, string[]>();
  for (const row of tagRows) {
    const tags = tagsById.get(row.memoryId) ?? [];
    tags.push(row.tag);
    tagsById.set(row.memoryId, tags);
  }

  const versionsById = new Map<string, ProjectMemoryVersionRow>();
  for (const row of versionRows) {
    versionsById.set(row.memoryId, row);
  }

  const projectionsById = new Map<string, ProjectMemoryProjectionRow>();
  for (const row of projectionRows) {
    projectionsById.set(row.memoryId, row);
  }

  const scopesById = new Map<string, AppliesTo>();
  for (const row of scopeRows) {
    const scope = scopesById.get(row.memoryId) ?? {};
    const patterns = scope[row.field] ?? [];
    patterns.push(row.pattern);
    scope[row.field] = patterns;
    scopesById.set(row.memoryId, scope);
  }

  const validationsById = new Map<string, ProjectMemoryValidationRow>();
  for (const row of validationRows) {
    validationsById.set(row.memoryId, row);
  }

  const validationActionsById = new Map<string, string[]>();
  for (const row of validationActionRows) {
    const actions = validationActionsById.get(row.memoryId) ?? [];
    actions.push(row.action);
    validationActionsById.set(row.memoryId, actions);
  }

  return rows.map(row => {
    const tags = normalizeTags(tagsById.get(row.id) ?? []);
    const version = versionsById.get(row.id);
    const projection = projectionsById.get(row.id);
    const validation = validationsById.get(row.id);
    const appliesTo = normalizeAppliesTo(scopesById.get(row.id) ?? {});
    const validatorActions = normalizeStringList(validationActionsById.get(row.id) ?? []);
    const validatorPayload = parseValidatorPayload(validation?.validatorPayload);
    const validatorConfig = normalizeValidatorConfig({
      ...validatorPayload,
      message: validation?.validatorMessage || undefined,
      actions: validatorActions,
    });

    return {
      id: row.id,
      scope: row.scope as ProjectMemory["scope"],
      category: row.category as ProjectMemory["category"],
      title: row.title,
      content: row.content,
      tags,
      sourceType: row.sourceType as ProjectMemory["sourceType"],
      sourceRef: row.sourceRef ?? "",
      status: row.status as ProjectMemory["status"],
      confidence: row.confidence as ProjectMemory["confidence"],
      taskId: row.taskId ?? null,
      fingerprint: version?.fingerprint || computeMemoryFingerprint(row.category, row.title, row.content),
      supersedes: version?.supersedesMemoryId ?? null,
      supersededBy: version?.supersededByMemoryId ?? null,
      kind: (row.kind as MemoryKind | null) ?? defaultKindFromCategory(row.category),
      projectionTarget: (projection?.projectionTarget as ProjectMemory["projectionTarget"]) ?? null,
      appliesTo,
      severity: (validation?.severity as ProjectMemory["severity"]) ?? MemorySeverity.INFO,
      validityStatus: (validation?.validityStatus as ProjectMemory["validityStatus"]) ?? ValidityStatus.FRESH,
      validityStaleReason: validation?.staleReason ?? "",
      validatorType: validation?.validatorType ?? "",
      validatorConfig,
      createdBy: row.createdBy ?? "",
      updatedBy: row.updatedBy ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

/**
 * Check for duplicate fingerprint among non-deprecated memories.
 */
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
    return { isDuplicate: true, existingId: existing[0].id, fingerprint: fp };
  }
  return { isDuplicate: false, fingerprint: fp };
}

export function createProjectMemory(data: ProjectMemoryCreate): ProjectMemory {
  const db = _getDb();
  const id = createId();
  const ts = now();
  const fp = computeMemoryFingerprint(data.category, data.title, data.content);
  const tags = normalizeTags(data.tags);
  const appliesTo = normalizeAppliesTo(data.appliesTo ?? {});
  const validatorConfig = normalizeValidatorConfig(data.validatorConfig);
  const kind = data.kind ?? defaultKindFromCategory(data.category);
  db.insert(s.projectMemories).values({
    id,
    scope: data.scope ?? "project",
    category: data.category,
    title: data.title,
    content: data.content,
    kind,
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

  db.insert(s.projectMemoryVersions).values({
    memoryId: id,
    fingerprint: fp,
    supersedesMemoryId: null,
    supersededByMemoryId: null,
  }).run();

  db.insert(s.projectMemoryProjections).values({
    memoryId: id,
    projectionTarget: data.projectionTarget ?? null,
  }).run();

  db.insert(s.projectMemoryValidations).values({
    memoryId: id,
    severity: data.severity ?? MemorySeverity.INFO,
    validityStatus: data.validity?.status ?? ValidityStatus.FRESH,
    staleReason: data.validity?.staleReason ?? "",
    validatorType: data.validatorType ?? "",
    validatorMessage: validatorConfig?.message ?? "",
    validatorPayload: serializeValidatorPayload(validatorConfig),
  }).run();

  replaceProjectMemoryTags(id, tags);
  replaceProjectMemoryScopes(id, appliesTo);
  replaceProjectMemoryValidationActions(id, validatorConfig?.actions ?? []);

  logEvent(EventType.PROJECT_MEMORY_CREATED, "project_memory", id, data.category);
  const memory = getProjectMemory(id);
  syncProjectMemoryFts(memory);
  return memory;
}

export function getProjectMemory(id: string): ProjectMemory {
  const db = _getDb();
  const row = db.select().from(s.projectMemories).where(eq(s.projectMemories.id, id)).get();
  if (!row) throw new Error(`project_memory not found: ${id}`);
  return hydrateProjectMemories([row])[0];
}

export function updateProjectMemory(id: string, fields: {
  title?: string;
  content?: string;
  tags?: string[];
  confidence?: string;
  updatedBy?: string;
  // V2
  kind?: string;
  projectionTarget?: string | null;
  appliesTo?: AppliesTo;
  severity?: string;
  validityStatus?: string;
  validityStaleReason?: string;
  // PR4 typed constraint validator
  validatorType?: string;
  validatorConfig?: ProjectMemoryValidatorConfig | null;
}): ProjectMemory {
  const db = _getDb();
  const existing = getProjectMemory(id);
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.content !== undefined) updates.content = fields.content;
  if (fields.confidence !== undefined) updates.confidence = fields.confidence;
  if (fields.updatedBy !== undefined) updates.updatedBy = fields.updatedBy;
  if (fields.title !== undefined || fields.content !== undefined) {
    const newTitle = fields.title ?? existing.title;
    const newContent = fields.content ?? existing.content;
    db.update(s.projectMemoryVersions).set({
      fingerprint: computeMemoryFingerprint(existing.category, newTitle, newContent),
    }).where(eq(s.projectMemoryVersions.memoryId, id)).run();
  }
  if (fields.kind !== undefined) updates.kind = fields.kind;

  db.update(s.projectMemories).set(updates).where(eq(s.projectMemories.id, id)).run();

  if (fields.tags !== undefined) {
    replaceProjectMemoryTags(id, normalizeTags(fields.tags));
  }

  if (fields.projectionTarget !== undefined) {
    db.update(s.projectMemoryProjections).set({
      projectionTarget: fields.projectionTarget,
    }).where(eq(s.projectMemoryProjections.memoryId, id)).run();
  }

  if (fields.appliesTo !== undefined) {
    replaceProjectMemoryScopes(id, normalizeAppliesTo(fields.appliesTo));
  }

  if (
    fields.severity !== undefined ||
    fields.validityStatus !== undefined ||
    fields.validityStaleReason !== undefined ||
    fields.validatorType !== undefined ||
    fields.validatorConfig !== undefined
  ) {
    const normalizedConfig = fields.validatorConfig !== undefined
      ? normalizeValidatorConfig(fields.validatorConfig)
      : existing.validatorConfig;

    db.update(s.projectMemoryValidations).set({
      severity: fields.severity ?? existing.severity,
      validityStatus: fields.validityStatus ?? existing.validityStatus,
      staleReason: fields.validityStaleReason ?? existing.validityStaleReason,
      validatorType: fields.validatorType ?? existing.validatorType,
      validatorMessage: normalizedConfig?.message ?? "",
      validatorPayload: serializeValidatorPayload(normalizedConfig),
    }).where(eq(s.projectMemoryValidations.memoryId, id)).run();

    replaceProjectMemoryValidationActions(id, normalizedConfig?.actions ?? []);
  }

  logEvent(EventType.PROJECT_MEMORY_UPDATED, "project_memory", id);
  const memory = getProjectMemory(id);
  syncProjectMemoryFts(memory);
  return memory;
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
  getProjectMemory(id);
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
    updatedBy,
    updatedAt: ts,
  }).where(eq(s.projectMemories.id, newId)).run();
  db.update(s.projectMemories).set({
    status: ProjectMemoryStatus.DEPRECATED,
    updatedBy,
    updatedAt: ts,
  }).where(eq(s.projectMemories.id, oldId)).run();
  db.update(s.projectMemoryVersions).set({
    supersedesMemoryId: oldId,
  }).where(eq(s.projectMemoryVersions.memoryId, newId)).run();
  db.update(s.projectMemoryVersions).set({
    supersededByMemoryId: newId,
  }).where(eq(s.projectMemoryVersions.memoryId, oldId)).run();
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

/**
 * Collect approved project memories for context injection.
 * P1 upgrade: deduplicates by fingerprint, excludes superseded,
 * returns canonical set ordered by priority (always-include first).
 */
/**
 * Collected memory shape for projection input.
 * Extends ProjectionInput with required validator fields (always populated with defaults).
 */
export type CollectedMemory = MemoryProjectionInput & {
  validatorType: string;
  validatorConfig: ProjectMemoryValidatorConfig | null;
};

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
