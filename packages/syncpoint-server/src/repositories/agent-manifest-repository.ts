/**
 * Agent Manifest Repository — CRUD for agent manifests.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db.js";
import * as schema from "../schema.js";

function now(): string {
  return new Date().toISOString();
}

export function upsertAgentManifest(opts: {
  agentId: string;
  capabilitiesJson?: string;
  escalationPreferenceJson?: string;
  availability?: string;
  canHandleHumanEscalation?: boolean;
  tagsJson?: string;
}) {
  const db = getDb();
  const ts = now();
  const existing = getAgentManifest(opts.agentId);

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: ts };
    if (opts.capabilitiesJson !== undefined) updates.capabilitiesJson = opts.capabilitiesJson;
    if (opts.escalationPreferenceJson !== undefined) updates.escalationPreferenceJson = opts.escalationPreferenceJson;
    if (opts.availability !== undefined) updates.availability = opts.availability;
    if (opts.canHandleHumanEscalation !== undefined) updates.canHandleHumanEscalation = opts.canHandleHumanEscalation;
    if (opts.tagsJson !== undefined) updates.tagsJson = opts.tagsJson;
    db.update(schema.agentManifests).set(updates).where(eq(schema.agentManifests.agentId, opts.agentId)).run();
    return getAgentManifest(opts.agentId)!;
  }

  const row = {
    agentId: opts.agentId,
    capabilitiesJson: opts.capabilitiesJson ?? "[]",
    escalationPreferenceJson: opts.escalationPreferenceJson ?? "{}",
    availability: opts.availability ?? "online",
    canHandleHumanEscalation: opts.canHandleHumanEscalation ?? false,
    tagsJson: opts.tagsJson ?? "[]",
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(schema.agentManifests).values(row).run();
  return row;
}

export function getAgentManifest(agentId: string) {
  const db = getDb();
  return db.select().from(schema.agentManifests).where(eq(schema.agentManifests.agentId, agentId)).get();
}

export function listAgentManifests() {
  const db = getDb();
  return db.select().from(schema.agentManifests).all();
}

export function deleteAgentManifest(agentId: string) {
  const db = getDb();
  db.delete(schema.agentManifests).where(eq(schema.agentManifests.agentId, agentId)).run();
}
