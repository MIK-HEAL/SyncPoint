/**
 * Agent Manifest Repository — CRUD for agent manifests.
 */

import { eq } from "drizzle-orm";
import type { AgentCapability, AgentManifest, EscalationPreference } from "syncpoint-core";
import { AgentManifestSchema, DEFAULT_AGENT_MANIFEST } from "syncpoint-core";
import * as schema from "../schema.js";
import { _getDb, now } from "./_shared.js";

/** Safe JSON parse — returns undefined on malformed text instead of throwing. */
function safeJsonParse<T>(raw: string): T | undefined {
  try { return JSON.parse(raw) as T; }
  catch { return undefined; }
}

function hydrateAgentManifest(row: typeof schema.agentManifests.$inferSelect): AgentManifest {
  const capabilities = AgentManifestSchema.shape.capabilities.safeParse(safeJsonParse<AgentCapability[]>(row.capabilitiesJson));
  const escalationPreference = AgentManifestSchema.shape.escalationPreference.safeParse(safeJsonParse<EscalationPreference>(row.escalationPreferenceJson));
  const availability = AgentManifestSchema.shape.availability.safeParse(row.availability);
  const tags = AgentManifestSchema.shape.tags.safeParse(safeJsonParse<string[]>(row.tagsJson));

  return AgentManifestSchema.parse({
    agentId: row.agentId,
    capabilities: capabilities.success ? capabilities.data : DEFAULT_AGENT_MANIFEST.capabilities,
    escalationPreference: escalationPreference.success
      ? escalationPreference.data
      : DEFAULT_AGENT_MANIFEST.escalationPreference,
    availability: availability.success ? availability.data : DEFAULT_AGENT_MANIFEST.availability,
    canHandleHumanEscalation: row.canHandleHumanEscalation,
    tags: tags.success ? tags.data : DEFAULT_AGENT_MANIFEST.tags,
  });
}

export function upsertAgentManifest(opts: {
  agentId: string;
  capabilities?: AgentCapability[];
  escalationPreference?: EscalationPreference;
  availability?: AgentManifest["availability"];
  canHandleHumanEscalation?: boolean;
  tags?: string[];
}): AgentManifest {
  const db = _getDb();
  const ts = now();
  const existing = getAgentManifest(opts.agentId);

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: ts };
    if (opts.capabilities !== undefined) updates.capabilitiesJson = JSON.stringify(opts.capabilities);
    if (opts.escalationPreference !== undefined) {
      updates.escalationPreferenceJson = JSON.stringify(opts.escalationPreference);
    }
    if (opts.availability !== undefined) updates.availability = opts.availability;
    if (opts.canHandleHumanEscalation !== undefined) updates.canHandleHumanEscalation = opts.canHandleHumanEscalation;
    if (opts.tags !== undefined) updates.tagsJson = JSON.stringify(opts.tags);
    db.update(schema.agentManifests).set(updates).where(eq(schema.agentManifests.agentId, opts.agentId)).run();
    return getAgentManifest(opts.agentId)!;
  }

  db.insert(schema.agentManifests).values({
    agentId: opts.agentId,
    capabilitiesJson: JSON.stringify(opts.capabilities ?? DEFAULT_AGENT_MANIFEST.capabilities),
    escalationPreferenceJson: JSON.stringify(opts.escalationPreference ?? DEFAULT_AGENT_MANIFEST.escalationPreference),
    availability: opts.availability ?? DEFAULT_AGENT_MANIFEST.availability,
    canHandleHumanEscalation: opts.canHandleHumanEscalation ?? DEFAULT_AGENT_MANIFEST.canHandleHumanEscalation,
    tagsJson: JSON.stringify(opts.tags ?? DEFAULT_AGENT_MANIFEST.tags),
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return getAgentManifest(opts.agentId)!;
}

export function getAgentManifest(agentId: string): AgentManifest | undefined {
  const db = _getDb();
  const row = db.select().from(schema.agentManifests).where(eq(schema.agentManifests.agentId, agentId)).get();
  return row ? hydrateAgentManifest(row) : undefined;
}

export function listAgentManifests(): AgentManifest[] {
  const db = _getDb();
  return db.select().from(schema.agentManifests).all().map(hydrateAgentManifest);
}

export function deleteAgentManifest(agentId: string) {
  const db = _getDb();
  db.delete(schema.agentManifests).where(eq(schema.agentManifests.agentId, agentId)).run();
}
