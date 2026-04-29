/**
 * PatchProposal repository — CRUD for patch_proposal table.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import { PatchProposalStatus } from "syncpoint-core";
import type { PatchProposal, PatchProposalCreate } from "syncpoint-core";
import { _getDb, now, createId } from "./_shared.js";

export function createPatchProposal(data: PatchProposalCreate): PatchProposal {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.patchProposals).values({
    id,
    sessionId: data.sessionId,
    taskId: data.taskId,
    agentId: data.agentId,
    title: data.title,
    summary: data.summary ?? "",
    patchText: data.patchText,
    touchedFiles: "",
    relatedClaimIds: "",
    status: PatchProposalStatus.DRAFT,
    checkResult: "",
    decisionSummary: "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return getPatchProposal(id);
}

export function getPatchProposal(id: string): PatchProposal {
  const db = _getDb();
  const row = db.select().from(s.patchProposals).where(eq(s.patchProposals.id, id)).get();
  if (!row) throw new Error(`patch_proposal not found: ${id}`);
  return row as unknown as PatchProposal;
}

export function updatePatchProposal(
  id: string,
  updates: Partial<{
    status: string;
    touchedFiles: string;
    relatedClaimIds: string;
    checkResult: string;
    decisionSummary: string;
  }>,
): PatchProposal {
  const db = _getDb();
  db.update(s.patchProposals).set({
    ...updates,
    updatedAt: now(),
  }).where(eq(s.patchProposals.id, id)).run();
  return getPatchProposal(id);
}

export function listPatchProposals(opts?: {
  sessionId?: string;
  taskId?: string;
  agentId?: string;
  status?: string;
}): PatchProposal[] {
  const db = _getDb();
  const conditions = [];
  if (opts?.sessionId) conditions.push(eq(s.patchProposals.sessionId, opts.sessionId));
  if (opts?.taskId) conditions.push(eq(s.patchProposals.taskId, opts.taskId));
  if (opts?.agentId) conditions.push(eq(s.patchProposals.agentId, opts.agentId));
  if (opts?.status) conditions.push(eq(s.patchProposals.status, opts.status));

  if (conditions.length === 0) {
    return db.select().from(s.patchProposals).all() as unknown as PatchProposal[];
  }
  return db.select().from(s.patchProposals)
    .where(and(...conditions))
    .all() as unknown as PatchProposal[];
}
