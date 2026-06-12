/**
 * ResourceClaim repository — CRUD for the normalized resource_claim + resource_claim_resource tables.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import { ResourceClaimStatus, ValidationError } from "syncpoint-kernel";
import type { ResourceClaim, ResourceClaimCreate, ResourceRef, ResourceScope } from "syncpoint-kernel";
import { _getDb, now, createId } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function loadResources(db: ReturnType<typeof _getDb>, claimId: string): ResourceRef[] {
  return db.select().from(s.resourceClaimResources)
    .where(eq(s.resourceClaimResources.claimId, claimId))
    .all()
    .map(r => ({
      type: r.resourceType,
      locator: r.locator,
      scope: (r.scope || "file") as ResourceScope,
      ...(r.functionName ? { functionName: r.functionName } : {}),
      ...(r.lineStart != null && r.lineEnd != null ? { lineRange: { start: r.lineStart, end: r.lineEnd } } : {}),
      metadata: r.metadata,
    }));
}

interface ResourceClaimRow {
  id: string;
  actorId: string;
  taskId: string;
  sessionId: string | null;
  mode: string;
  status: string;
  createdAt: string;
  releasedAt: string | null;
}

function rowToResourceClaim(row: ResourceClaimRow, resources: ResourceRef[]): ResourceClaim {
  return {
    id: row.id,
    actorId: row.actorId,
    taskId: row.taskId,
    sessionId: row.sessionId ?? "",
    resources,
    mode: row.mode as ResourceClaim["mode"],
    status: row.status as ResourceClaim["status"],
    createdAt: row.createdAt,
    releasedAt: row.releasedAt ?? "",
  };
}

// ── CRUD ────────────────────────────────────────────

export function createResourceClaim(data: ResourceClaimCreate): ResourceClaim {
  const db = _getDb();
  if (data.resources.length === 0) {
    throw new ValidationError("resources", "resource_claim requires at least one resource");
  }
  const resourceType = data.resources[0]!.type;
  if (data.resources.some(resource => resource.type !== resourceType)) {
    throw new ValidationError("resources", "resource_claim resources must all have the same type");
  }
  const id = createId();
  const ts = now();
  db.insert(s.resourceClaims).values({
    id,
    actorId: data.actorId,
    taskId: data.taskId,
    sessionId: data.sessionId ?? "",
    resourceType,
    mode: data.mode ?? "exclusive",
    status: ResourceClaimStatus.ACTIVE,
    createdAt: ts,
    releasedAt: "",
  }).run();
  // Insert resources into join table
  for (const ref of data.resources) {
    db.insert(s.resourceClaimResources).values({
      id: createId(),
      claimId: id,
      resourceType: ref.type,
      locator: ref.locator,
      scope: ref.scope,
      functionName: ref.functionName ?? null,
      lineStart: ref.lineRange?.start ?? null,
      lineEnd: ref.lineRange?.end ?? null,
      metadata: ref.metadata ?? "",
    }).run();
  }
  return getResourceClaim(id);
}

export function getResourceClaim(id: string): ResourceClaim {
  const db = _getDb();
  const row = db.select().from(s.resourceClaims).where(eq(s.resourceClaims.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return rowToResourceClaim(row, loadResources(db, id));
}

export function releaseResourceClaim(id: string): ResourceClaim {
  const db = _getDb();
  db.update(s.resourceClaims).set({
    status: ResourceClaimStatus.RELEASED,
    releasedAt: now(),
  }).where(eq(s.resourceClaims.id, id)).run();
  return getResourceClaim(id);
}

export function listResourceClaims(opts?: {
  actorId?: string;
  taskId?: string;
  sessionId?: string;
  resourceType?: string;
  status?: string;
}): ResourceClaim[] {
  const db = _getDb();
  const predicates = [];
  if (opts?.actorId) predicates.push(eq(s.resourceClaims.actorId, opts.actorId));
  if (opts?.taskId) predicates.push(eq(s.resourceClaims.taskId, opts.taskId));
  if (opts?.sessionId) predicates.push(eq(s.resourceClaims.sessionId, opts.sessionId));
  if (opts?.resourceType) predicates.push(eq(s.resourceClaims.resourceType, opts.resourceType));
  if (opts?.status) predicates.push(eq(s.resourceClaims.status, opts.status));

  const rows = predicates.length === 0
    ? db.select().from(s.resourceClaims).all()
    : db.select().from(s.resourceClaims).where(and(...predicates)).all();

  return rows.map(row => rowToResourceClaim(row, loadResources(db, row.id)));
}

export function listActiveResourceClaims(opts?: {
  sessionId?: string;
  resourceType?: string;
}): ResourceClaim[] {
  const db = _getDb();
  const predicates = [eq(s.resourceClaims.status, ResourceClaimStatus.ACTIVE)];
  if (opts?.sessionId) predicates.push(eq(s.resourceClaims.sessionId, opts.sessionId));
  if (opts?.resourceType) predicates.push(eq(s.resourceClaims.resourceType, opts.resourceType));
  return db.select().from(s.resourceClaims)
    .where(and(...predicates))
    .all()
    .map(row => rowToResourceClaim(row, loadResources(db, row.id)));
}

/**
 * Update the line range (lineStart, lineEnd) for a specific resource
 * within a claim. Used by line-range drift tracking when source files
 * are edited and line numbers shift.
 */
export function updateResourceLineRange(
  claimId: string,
  locator: string,
  newStart: number,
  newEnd: number,
): void {
  const db = _getDb();
  db.update(s.resourceClaimResources)
    .set({ lineStart: newStart, lineEnd: newEnd })
    .where(
      and(
        eq(s.resourceClaimResources.claimId, claimId),
        eq(s.resourceClaimResources.locator, locator),
        eq(s.resourceClaimResources.scope, "line_range"),
      ),
    )
    .run();
}

/**
 * Find all active resource claims that have a line_range–scoped resource
 * for the given file locator. Used to determine which claims need their
 * line ranges remapped after a file edit.
 */
export function findActiveLineRangeClaimsForLocator(locator: string): ResourceClaim[] {
  const db = _getDb();
  const rows = db.select({ claimId: s.resourceClaimResources.claimId })
    .from(s.resourceClaimResources)
    .where(
      and(
        eq(s.resourceClaimResources.locator, locator),
        eq(s.resourceClaimResources.scope, "line_range"),
      ),
    )
    .all();

  const claimIds = [...new Set(rows.map(r => r.claimId))];
  return claimIds
    .map(id => {
      try {
        const claim = getResourceClaim(id);
        return claim.status === ResourceClaimStatus.ACTIVE ? claim : null;
      } catch {
        return null;
      }
    })
    .filter((c): c is ResourceClaim => c !== null);
}
