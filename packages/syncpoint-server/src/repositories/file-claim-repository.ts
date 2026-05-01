/**
 * FileClaim repository — CRUD for file_claim table.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import { FileClaimStatus } from "syncpoint-core";
import type { FileClaim, FileClaimCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

export function createFileClaim(data: FileClaimCreate): FileClaim {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.fileClaims).values({
    id,
    agentId: data.agentId,
    taskId: data.taskId,
    sessionId: data.sessionId ?? "",
    paths: data.paths,
    mode: data.mode ?? "exclusive",
    status: FileClaimStatus.ACTIVE,
    createdAt: ts,
    releasedAt: "",
  }).run();
  return getFileClaim(id);
}

export function getFileClaim(id: string): FileClaim {
  const db = _getDb();
  const row = db.select().from(s.fileClaims).where(eq(s.fileClaims.id, id)).get();
  if (!row) throw new Error(`file_claim not found: ${id}`);
  return row as unknown as FileClaim;
}

export function releaseFileClaim(id: string): FileClaim {
  const db = _getDb();
  db.update(s.fileClaims).set({
    status: FileClaimStatus.RELEASED,
    releasedAt: now(),
  }).where(eq(s.fileClaims.id, id)).run();
  return getFileClaim(id);
}

export function listFileClaims(opts?: {
  agentId?: string;
  taskId?: string;
  sessionId?: string;
  status?: string;
}): FileClaim[] {
  const db = _getDb();
  const predicates = [];
  if (opts?.agentId) predicates.push(eq(s.fileClaims.agentId, opts.agentId));
  if (opts?.taskId) predicates.push(eq(s.fileClaims.taskId, opts.taskId));
  if (opts?.sessionId) predicates.push(eq(s.fileClaims.sessionId, opts.sessionId));
  if (opts?.status) predicates.push(eq(s.fileClaims.status, opts.status));

  if (predicates.length === 0) {
    return db.select().from(s.fileClaims).all() as unknown as FileClaim[];
  }
  return db.select().from(s.fileClaims)
    .where(and(...predicates))
    .all() as unknown as FileClaim[];
}

export function listActiveFileClaims(sessionId?: string): FileClaim[] {
  const db = _getDb();
  if (sessionId) {
    return db.select().from(s.fileClaims)
      .where(and(
        eq(s.fileClaims.status, FileClaimStatus.ACTIVE),
        eq(s.fileClaims.sessionId, sessionId),
      ))
      .all() as unknown as FileClaim[];
  }
  return db.select().from(s.fileClaims)
    .where(eq(s.fileClaims.status, FileClaimStatus.ACTIVE))
    .all() as unknown as FileClaim[];
}
