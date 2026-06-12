import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { ConstraintViolationError, EventType, ResourceNotFoundError } from "syncpoint-kernel";
import {
  ProjectMemoryStatus,
  computeMemoryFingerprint,
  defaultKindFromCategory,
  ValidityStatus,
  MemorySeverity,
} from "syncpoint-context";
import type {
  AppliesTo,
  ProjectMemoryValidatorConfig,
  ProjectMemory,
  ProjectMemoryCreate,
} from "syncpoint-context";
import { _getDb, createId, now, logEvent } from "./_shared.js";
import {
  normalizeAppliesTo,
  normalizeTags,
  normalizeValidatorConfig,
  replaceProjectMemoryScopes,
  replaceProjectMemoryTags,
  replaceProjectMemoryValidationActions,
  serializeValidatorPayload,
  syncProjectMemoryFts,
} from "./project-memory-repository-internals.js";
import { getProjectMemory } from "./project-memory-repository-read.js";
import { bumpMemoryVersion } from "./project-memory-repository-version.js";

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

export function updateProjectMemory(id: string, fields: {
  title?: string;
  content?: string;
  tags?: string[];
  confidence?: string;
  updatedBy?: string;
  kind?: string;
  projectionTarget?: string | null;
  appliesTo?: AppliesTo;
  severity?: string;
  validityStatus?: string;
  validityStaleReason?: string;
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
    throw new ConstraintViolationError(["memory_is_deprecated"], `Cannot approve deprecated project memory ${id}`);
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

export function supersedeProjectMemory(newId: string, oldId: string, updatedBy: string): { newMem: ProjectMemory; oldMem: ProjectMemory } {
  const db = _getDb();
  const newMem = getProjectMemory(newId);
  const oldMem = getProjectMemory(oldId);
  if (oldMem.status === ProjectMemoryStatus.DEPRECATED && oldMem.supersededBy) {
    throw new ConstraintViolationError(["memory_already_superseded"], `Memory ${oldId} is already superseded by ${oldMem.supersededBy}`);
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
