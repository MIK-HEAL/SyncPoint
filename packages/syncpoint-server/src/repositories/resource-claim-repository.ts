/**
 * ResourceClaim repository — CRUD for the generic resource_claim table.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import { ResourceClaimStatus } from "syncpoint-core";
import type { ResourceClaim, ResourceClaimCreate, ResourceRef } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

// ── Internal helpers ────────────────────────────────

function refsToJson(refs: ResourceRef[]): string {
  return JSON.stringify(refs);
}

function jsonToRefs(json: string): ResourceRef[] {
  try { return JSON.parse(json); } catch { return []; }
}

function rowToResourceClaim(row: any): ResourceClaim {
  return {
    id: row.id,
    actorId: row.actorId,
    taskId: row.taskId,
    sessionId: row.sessionId ?? "",
    resources: jsonToRefs(row.resourcesJson),
    mode: row.mode as any,
    status: row.status as any,
    createdAt: row.createdAt,
    releasedAt: row.releasedAt ?? "",
  };
}

// ── CRUD ────────────────────────────────────────────

export function createResourceClaim(data: ResourceClaimCreate): ResourceClaim {
  const db = _getDb();
  if (data.resources.length === 0) {
    throw new Error("resource_claim requires at least one resource");
  }
  const resourceType = data.resources[0].type;
  if (data.resources.some(resource => resource.type !== resourceType)) {
    throw new Error("resource_claim resources must all have the same type");
  }
  const id = createId();
  const ts = now();
  db.insert(s.resourceClaims).values({
    id,
    actorId: data.actorId,
    taskId: data.taskId,
    sessionId: data.sessionId ?? "",
    resourceType,
    resourcesJson: refsToJson(data.resources),
    mode: data.mode ?? "exclusive",
    status: ResourceClaimStatus.ACTIVE,
    createdAt: ts,
    releasedAt: "",
  }).run();
  return getResourceClaim(id);
}

export function getResourceClaim(id: string): ResourceClaim {
  const db = _getDb();
  const row = db.select().from(s.resourceClaims).where(eq(s.resourceClaims.id, id)).get();
  if (!row) throw new Error(`resource_claim not found: ${id}`);
  return rowToResourceClaim(row);
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

  return rows.map(rowToResourceClaim);
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
    .map(rowToResourceClaim);
}
