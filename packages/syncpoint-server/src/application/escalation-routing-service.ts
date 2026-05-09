/**
 * Escalation Routing Service — wires agent manifests with gate escalation.
 *
 * API:
 *   manifestUpsert(agentId, manifest)  — create or update manifest
 *   manifestGet(agentId)               — get parsed manifest
 *   manifestList()                     — list all manifests
 *   manifestDelete(agentId)            — remove manifest
 *   routeGateEscalation(gateId)       — find best agents for a gate escalation
 */

import {
  AgentManifestSchema,
  EscalationPreferenceSchema,
  AgentAvailability,
  routeEscalation,
  parseGatePolicy,
  isGateBlocking,
} from "syncpoint-core";
import type {
  AgentManifest,
  AgentCapability,
  EscalationPreference,
  EscalationCandidate,
  EscalationRoutingInput,
  SyncGate,
} from "syncpoint-core";
import * as manifestRepo from "../repositories/agent-manifest-repository.js";
import { getSyncGate, listActiveSyncGates } from "../repositories/sync-gate-repository.js";

// ── Manifest CRUD ────────────────────────────────────

export function manifestUpsert(agentId: string, input: {
  capabilities?: AgentCapability[];
  escalationPreference?: Partial<EscalationPreference>;
  availability?: AgentAvailability;
  canHandleHumanEscalation?: boolean;
  tags?: string[];
}): AgentManifest {
  manifestRepo.upsertAgentManifest({
    agentId,
    capabilitiesJson: input.capabilities ? JSON.stringify(input.capabilities) : undefined,
    escalationPreferenceJson: input.escalationPreference
      ? JSON.stringify(EscalationPreferenceSchema.parse(input.escalationPreference))
      : undefined,
    availability: input.availability,
    canHandleHumanEscalation: input.canHandleHumanEscalation,
    tagsJson: input.tags ? JSON.stringify(input.tags) : undefined,
  });

  return manifestGet(agentId)!;
}

export function manifestGet(agentId: string): AgentManifest | null {
  const row = manifestRepo.getAgentManifest(agentId);
  if (!row) return null;
  return rowToManifest(row);
}

export function manifestList(): AgentManifest[] {
  return manifestRepo.listAgentManifests().map(rowToManifest);
}

export function manifestDelete(agentId: string): void {
  manifestRepo.deleteAgentManifest(agentId);
}

function rowToManifest(row: {
  agentId: string;
  capabilitiesJson: string;
  escalationPreferenceJson: string;
  availability: string;
  canHandleHumanEscalation: boolean;
  tagsJson: string;
}): AgentManifest {
  return AgentManifestSchema.parse({
    agentId: row.agentId,
    capabilities: JSON.parse(row.capabilitiesJson || "[]"),
    escalationPreference: JSON.parse(row.escalationPreferenceJson || "{}"),
    availability: row.availability,
    canHandleHumanEscalation: row.canHandleHumanEscalation,
    tags: JSON.parse(row.tagsJson || "[]"),
  });
}

// ── Escalation routing ──────────────────────────────

/**
 * Given a gate that has escalated, find the best candidates to handle it.
 */
export function routeGateEscalation(gateId: string): EscalationCandidate[] {
  const gate = getSyncGate(gateId);
  const policy = parseGatePolicy(gate);

  const requiresHuman =
    gate.status === "ESCALATED" ||
    gate.status === "TIMED_OUT" ||
    policy.kind === "human_required";

  const input: EscalationRoutingInput = {
    gateId: gate.id,
    taskId: gate.taskId,
    reason: gate.decisionSummary || gate.reason,
    requiredAgentIds: (gate.requiredAgentIds || "").split(",").filter(Boolean),
    escalationAgentIds: policy.escalationAgentIds ?? [],
    requiresHuman,
  };

  const manifests = manifestList();

  // Count active escalations per agent (gates in ESCALATED state where the agent is an escalation target)
  const activeEscalationCounts = countActiveEscalations();

  return routeEscalation(input, manifests, activeEscalationCounts);
}

/**
 * Count how many active (ESCALATED) gates each agent is involved in as an escalation target.
 */
function countActiveEscalations(): Map<string, number> {
  const counts = new Map<string, number>();
  const activeGates = listActiveSyncGates();
  for (const gate of activeGates) {
    if (gate.status === "ESCALATED") {
      const policy = parseGatePolicy(gate);
      for (const id of policy.escalationAgentIds ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}
