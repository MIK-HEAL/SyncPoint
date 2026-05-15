/**
 * Project Memory use cases.
 * CLI, tRPC, and MCP all share this layer.
 */

import fs from "node:fs";
import path from "node:path";
import {
  MemoryKind,
  ProjectionTarget,
  isValidProjection,
  defaultKindFromCategory,
  isConstraintRuleKnown,
} from "syncpoint-core";
import type { ProjectMemory, ProjectMemoryCreate, MemoryDedupResult } from "syncpoint-core";
import * as repo from "../repositories.js";
import { isProjectLocal, getSyncpointDir } from "../db.js";

// ── Types ────────────────────────────────────────────

export interface ProjectMemoryAddInput extends ProjectMemoryCreate {
  /** If true, skip project-local check */
  global?: boolean;
}

export interface ProjectMemoryExportResult {
  path: string;
  count: number;
  content: string;
}

// ── Path guard ────────────────────────────────────────

export class ProjectMemoryPathError extends Error {
  constructor(message?: string) {
    super(
      message ??
      "No project-local .syncpoint/ found. Run `syncpoint init` first, " +
      "or use --global to write to the fallback location."
    );
    this.name = "ProjectMemoryPathError";
  }
}

function ensureProjectLocal(global?: boolean): void {
  if (global) return;
  if (!isProjectLocal()) throw new ProjectMemoryPathError();
}

// ── Caller identity guard ────────────────────────────

export class CallerIdentityError extends Error {
  constructor() {
    super(
      "Caller identity required. Provide callerBy (agentId or user identifier) " +
      "for all project memory write operations."
    );
    this.name = "CallerIdentityError";
  }
}

function requireCallerIdentity(callerBy: string | undefined): asserts callerBy is string {
  if (!callerBy || callerBy.trim().length === 0) {
    throw new CallerIdentityError();
  }
}

// ── Export path containment ──────────────────────────

/**
 * Validate that the resolved export path is within the .syncpoint/ directory
 * or a direct child of the project root. Prevents path traversal attacks.
 */
function validateExportPath(resolvedPath: string): void {
  const normalized = path.resolve(resolvedPath);
  const spDir = path.resolve(getSyncpointDir());
  const projectRoot = path.dirname(spDir);

  // Allow: anything inside .syncpoint/ (the standard location)
  if (normalized.startsWith(spDir + path.sep) || normalized === spDir) return;

  // Allow: direct children of the project root (e.g. PROJECT_ROOT/project-memory.md)
  const parent = path.dirname(normalized);
  if (parent === projectRoot) return;

  throw new ProjectMemoryPathError(
    `Export path "${resolvedPath}" is outside the allowed directory. ` +
    `Allowed: inside ${spDir} or directly under ${projectRoot}.`
  );
}

// ── Use cases ────────────────────────────────────────

export class DuplicateMemoryError extends Error {
  public readonly existingId: string;
  constructor(existingId: string) {
    super(
      `Duplicate project memory detected. Existing memory: ${existingId}. ` +
      `Use supersede to replace it, or update the existing memory.`
    );
    this.name = "DuplicateMemoryError";
    this.existingId = existingId;
  }
}

export class InvalidProjectionError extends Error {
  constructor(kind: string, target: string) {
    super(
      `Memory kind "${kind}" cannot project to "${target}". ` +
      `hard_constraint and protocol_rule must target protocol_gate or constraint_runtime.`
    );
    this.name = "InvalidProjectionError";
  }
}

/**
 * P4: Blocking hard_constraint memories must specify a validatorType.
 * Without a typed validator, the constraint runtime treats the memory as advisory
 * only. Requiring validatorType at write time ensures intent is explicit.
 */
export class MissingValidatorError extends Error {
  constructor() {
    super(
      `Blocking hard_constraint requires a validatorType. ` +
      `Without a typed validator, the constraint is advisory only. ` +
      `Provide a validatorType registered by a plugin (e.g. "file_forbidden", "resource_forbidden") ` +
      `to enable runtime enforcement.`
    );
    this.name = "MissingValidatorError";
  }
}

/**
 * P4: Unknown validatorType — not registered by any plugin or core built-in.
 */
export class UnknownValidatorTypeError extends Error {
  constructor(given: string) {
    super(
      `Unknown validatorType "${given}". ` +
      `No constraint rule evaluator is registered for this type. ` +
      `Ensure the appropriate plugin is loaded (e.g. syncpoint-plugin-code for "file_forbidden").`
    );
    this.name = "UnknownValidatorTypeError";
  }
}

/**
 * P4: Validate that blocking hard_constraints have a known validatorType.
 * Uses isConstraintRuleKnown() from core, which checks core built-ins
 * and plugin-registered evaluators — no hardcoded allowlist.
 */
function requireValidatorForBlockingConstraint(
  kind: string,
  severity: string | undefined,
  validatorType: string | undefined,
): void {
  if (kind === "hard_constraint" && severity === "blocking") {
    if (!validatorType || validatorType.trim().length === 0) {
      throw new MissingValidatorError();
    }
    if (!isConstraintRuleKnown(validatorType.trim())) {
      throw new UnknownValidatorTypeError(validatorType);
    }
  }
}

export function pmAdd(input: ProjectMemoryAddInput): ProjectMemory {
  requireCallerIdentity(input.createdBy);
  ensureProjectLocal(input.global);
  // Dedup check: reject if identical fingerprint exists in non-deprecated state
  const dedup = repo.checkMemoryDuplicate(input.category, input.title, input.content);
  if (dedup.isDuplicate) {
    throw new DuplicateMemoryError(dedup.existingId!);
  }
  // V2 projection guard: hard_constraint / protocol_rule cannot target context_snapshot
  const kind = input.kind ?? defaultKindFromCategory(input.category);
  if (input.projectionTarget) {
    if (!isValidProjection(kind, input.projectionTarget as ProjectionTarget)) {
      throw new InvalidProjectionError(kind, input.projectionTarget);
    }
  }
  // P4: blocking hard_constraint requires validatorType
  requireValidatorForBlockingConstraint(kind, input.severity, input.validatorType);
  return repo.createProjectMemory(input);
}

/**
 * Check for duplicate without creating — for callers that want to inspect before deciding.
 */
export function pmCheckDuplicate(category: string, title: string, content: string): MemoryDedupResult {
  return repo.checkMemoryDuplicate(category, title, content);
}

export function pmGet(id: string): ProjectMemory {
  return repo.getProjectMemory(id);
}

export function pmUpdate(id: string, fields: {
  title?: string;
  content?: string;
  tags?: string;
  confidence?: string;
  updatedBy: string;
  // V2
  kind?: string;
  projectionTarget?: string | null;
  appliesTo?: string;
  severity?: string;
  validityStatus?: string;
  validityStaleReason?: string;
  // PR4 typed constraint validator
  validatorType?: string;
  validatorConfig?: string;
}): ProjectMemory {
  requireCallerIdentity(fields.updatedBy);
  // V2 projection guard on update — validate against FINAL merged state
  const existing = repo.getProjectMemory(id);
  const finalKind = (fields.kind ?? existing.kind ?? defaultKindFromCategory(existing.category)) as MemoryKind;
  const finalTarget = (fields.projectionTarget !== undefined ? fields.projectionTarget : existing.projectionTarget) as ProjectionTarget | null;
  if (finalTarget !== undefined && finalTarget !== null) {
    if (!isValidProjection(finalKind, finalTarget)) {
      throw new InvalidProjectionError(finalKind, finalTarget);
    }
  }
  // P4: blocking hard_constraint requires validatorType (merged state)
  const finalSeverity = (fields.severity ?? existing.severity) as string;
  const finalValidatorType = (fields.validatorType ?? existing.validatorType) as string | undefined;
  requireValidatorForBlockingConstraint(finalKind, finalSeverity, finalValidatorType);
  return repo.updateProjectMemory(id, fields);
}

export function pmApprove(id: string, updatedBy: string): ProjectMemory {
  requireCallerIdentity(updatedBy);
  return repo.approveProjectMemory(id, updatedBy);
}

export function pmDeprecate(id: string, updatedBy: string): ProjectMemory {
  requireCallerIdentity(updatedBy);
  return repo.deprecateProjectMemory(id, updatedBy);
}

/**
 * Supersede: mark newId as replacement for oldId.
 * Old memory is deprecated with supersededBy link. New memory gets supersedes link.
 */
export function pmSupersede(newId: string, oldId: string, updatedBy: string): { newMem: ProjectMemory; oldMem: ProjectMemory } {
  requireCallerIdentity(updatedBy);
  return repo.supersedeProjectMemory(newId, oldId, updatedBy);
}

/**
 * Get the current memory version counter.
 */
export function pmGetVersion(): number {
  return repo.getMemoryVersion();
}

export function pmList(filters?: {
  status?: string;
  category?: string;
  scope?: string;
  taskId?: string;
}): ProjectMemory[] {
  return repo.listProjectMemories(filters);
}

export function pmSearch(query: string): ProjectMemory[] {
  return repo.searchProjectMemories(query);
}

// ── Export ────────────────────────────────────────────

/**
 * Resolve the project-memory.md output path.
 * Priority: explicit arg > SYNCPOINT_MEMORY_PATH env > .syncpoint/project-memory.md
 */
function resolveMemoryPath(outputPath?: string): string {
  if (outputPath) return outputPath;
  if (process.env.SYNCPOINT_MEMORY_PATH) return process.env.SYNCPOINT_MEMORY_PATH;
  return path.join(getSyncpointDir(), "project-memory.md");
}

/**
 * Export approved project memories to .syncpoint/project-memory.md.
 * Returns the file path and content written.
 */
export function pmExport(outputPath?: string, callerBy?: string): ProjectMemoryExportResult {
  requireCallerIdentity(callerBy);
  // P1: use canonical collection — deduplicates by fingerprint, excludes superseded
  const canonical = repo.collectProjectMemories();
  const canonicalIds = new Set(canonical.map(m => m.id));
  const approved = repo.listProjectMemories({ status: "approved" })
    .filter(m => canonicalIds.has(m.id));
  const content = renderProjectMemoryMarkdown(approved);

  const target = resolveMemoryPath(outputPath);
  validateExportPath(target);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(target, content, "utf-8");

  return { path: target, count: approved.length, content };
}

function renderProjectMemoryMarkdown(memories: ProjectMemory[]): string {
  const lines: string[] = [];

  lines.push("# Project Memory");
  lines.push("");
  lines.push("> Auto-generated by SyncPoint. Do not edit manually.");
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Entries: ${memories.length} approved`);
  lines.push("");

  // Group by category
  const byCategory = new Map<string, ProjectMemory[]>();
  for (const m of memories) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  const categoryOrder = [
    "overview", "architecture", "decision", "convention",
    "risk", "gotcha", "glossary", "file-map", "integration",
  ];

  for (const cat of categoryOrder) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;

    lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
    lines.push("");

    for (const m of items) {
      lines.push(`### ${m.title}`);
      if (m.tags) lines.push(`> Tags: ${m.tags}`);
      if (m.confidence !== "medium") lines.push(`> Confidence: ${m.confidence}`);
      if (m.scope !== "project") lines.push(`> Scope: ${m.scope}`);
      // V2 metadata
      if (m.kind && m.kind !== "fact") lines.push(`> Kind: ${m.kind}`);
      if (m.severity && m.severity !== "info") lines.push(`> Severity: ${m.severity}`);
      if (m.projectionTarget) lines.push(`> Projection: ${m.projectionTarget}`);
      if (m.validityStatus && m.validityStatus !== "fresh") lines.push(`> Validity: ${m.validityStatus}`);
      if (m.appliesTo) {
        try {
          const at = JSON.parse(m.appliesTo);
          if (at.files?.length) lines.push(`> Files: ${at.files.join(", ")}`);
          if (at.modules?.length) lines.push(`> Modules: ${at.modules.join(", ")}`);
        } catch { /* not valid JSON, skip */ }
      }
      lines.push("");
      lines.push(m.content);
      lines.push("");
    }
  }

  return lines.join("\n");
}
