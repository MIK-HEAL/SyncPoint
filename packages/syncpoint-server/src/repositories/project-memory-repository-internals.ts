import { eq, inArray } from "drizzle-orm";
import * as s from "../schema.js";
import {
  computeMemoryFingerprint,
  defaultKindFromCategory,
  MemoryKind,
  ValidityStatus,
  MemorySeverity,
} from "syncpoint-context";
import type {
  AppliesTo,
  ProjectMemoryValidatorConfig,
  ProjectMemory,
  MemoryProjectionInput,
} from "syncpoint-context";
import { defaultContext } from "../db.js";
import { _getDb, createId } from "./_shared.js";

export type ProjectMemoryRow = typeof s.projectMemories.$inferSelect;
export type ProjectMemoryVersionRow = typeof s.projectMemoryVersions.$inferSelect;
export type ProjectMemoryProjectionRow = typeof s.projectMemoryProjections.$inferSelect;
export type ProjectMemoryValidationRow = typeof s.projectMemoryValidations.$inferSelect;

export type CollectedMemory = MemoryProjectionInput & {
  validatorType: string;
  validatorConfig: ProjectMemoryValidatorConfig | null;
};

function normalizeStringList(values?: string[] | null): string[] {
  return [...new Set((values ?? []).map(v => v.trim()).filter(Boolean))];
}

export function normalizeTags(tags?: string[] | null): string[] {
  return normalizeStringList(tags);
}

export function normalizeAppliesTo(appliesTo?: AppliesTo | null): AppliesTo {
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

export function normalizeValidatorConfig(config?: ProjectMemoryValidatorConfig | null): ProjectMemoryValidatorConfig | null {
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

export function serializeValidatorPayload(config: ProjectMemoryValidatorConfig | null): string {
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

export function buildFtsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu) ?? query.split(/\s+/).filter(Boolean);
  return tokens.map(token => `${token.replace(/"/g, '""')}*`).join(" AND ");
}

function ensureProjectMemoryFtsSchema(): void {
  const raw = defaultContext.raw;
  raw.exec(s.PROJECT_MEMORY_FTS_SQL);
}

export function syncProjectMemoryFts(memory: ProjectMemory): void {
  const raw = defaultContext.raw;
  ensureProjectMemoryFtsSchema();
  raw.prepare("DELETE FROM project_memory_fts WHERE memory_id = ?").run(memory.id);
  raw.prepare(
    "INSERT INTO project_memory_fts(memory_id, title, content, category, tags) VALUES (?, ?, ?, ?, ?)",
  ).run(memory.id, memory.title, memory.content, memory.category, buildFtsTagText(memory.tags));
}

export function replaceProjectMemoryTags(memoryId: string, tags: string[]): void {
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

export function replaceProjectMemoryScopes(memoryId: string, appliesTo: AppliesTo): void {
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

export function replaceProjectMemoryValidationActions(memoryId: string, actions: string[]): void {
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

export function hydrateProjectMemories(rows: ProjectMemoryRow[]): ProjectMemory[] {
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
      schemaVersion: 2,
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
