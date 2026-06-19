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

import { EscalationPreferenceSchema, AgentAvailability, routeEscalation } from "syncpoint-adapters";
import { parseGatePolicy, isGateBlocking } from "syncpoint-kernel";
import type { AgentManifest, AgentCapability, EscalationPreference, EscalationCandidate, EscalationRoutingInput } from "syncpoint-adapters";
import type { SyncGate } from "syncpoint-kernel";
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
    capabilities: input.capabilities,
    escalationPreference: input.escalationPreference
      ? EscalationPreferenceSchema.parse(input.escalationPreference)
      : undefined,
    availability: input.availability,
    canHandleHumanEscalation: input.canHandleHumanEscalation,
    tags: input.tags,
  });

  return manifestGet(agentId)!;
}

export function manifestGet(agentId: string): AgentManifest | null {
  return manifestRepo.getAgentManifest(agentId) ?? null;
}

export function manifestList(): AgentManifest[] {
  return manifestRepo.listAgentManifests();
}

export function manifestDelete(agentId: string): void {
  manifestRepo.deleteAgentManifest(agentId);
}

// ── Escalation routing ──────────────────────────────

/**
 * Given a gate that has escalated, find the best candidates to handle it.
 */
export function routeGateEscalation(gateId: string): EscalationCandidate[] {
  const gate = getSyncGate(gateId);
  const policy = parseGatePolicy(gate);

  const requiresHuman =
    gate.escalated && (policy.escalationAgentIds ?? []).length === 0;

  const input: EscalationRoutingInput = {
    gateId: gate.id,
    taskId: gate.taskId,
    reason: gate.decisionSummary || gate.reason,
    requiredAgentIds: gate.requiredAgentIds ?? [],
    escalationAgentIds: policy.escalationAgentIds ?? [],
    requiresHuman,
  };

  const manifests = manifestList();

  // Count active escalations per agent (gates in ESCALATED state where the agent is an escalation target)
  const activeEscalationCounts = countActiveEscalations();

  return routeEscalation(input, manifests, activeEscalationCounts);
}

/**
 * Count how many active escalated gates each agent is involved in as an escalation target.
 */
function countActiveEscalations(): Map<string, number> {
  const counts = new Map<string, number>();
  const activeGates = listActiveSyncGates();
  for (const gate of activeGates) {
    if (gate.escalated) {
      const policy = parseGatePolicy(gate);
      for (const id of policy.escalationAgentIds ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}
