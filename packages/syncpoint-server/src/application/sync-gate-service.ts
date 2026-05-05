/**
 * SyncGate Service — synchronization barriers.
 *
 * Use cases:
 *   sgRequest    — create a sync gate and move it to SYNC_REQUESTED
 *   sgAck        — agent acknowledges a gate
 *   sgResolve    — manually resolve a gate (→ READY_TO_CONTINUE)
 *   sgCancel     — cancel a gate
 *   sgStatus     — get gate status with pending/blocked info
 *   sgListActive — list active gates for a task/session
 *   sgCheckAgent — check if an agent is blocked by any active gate
 */

import {
  SyncGateStatus,
  SyncGateReason,
  EventType,
  validateSyncGateTransition,
  allAcked,
  pendingAgents,
  isAgentBlocked,
  parseIdList,
} from "syncpoint-core";
import type { SyncGate, SyncGateCreate } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";

// ── Types ──────────────────────────────────────────────

export interface SyncGateRequestInput {
  sessionId?: string;
  taskId: string;
  requestedByAgentId: string;
  requiredAgentIds: string[];
  reason?: string;
  description?: string;
  relatedFiles?: string;
  relatedResourcesJson?: string;
  relatedCheckpointId?: string;
  relatedClaimIds?: string;
}

export interface SyncGateStatusResult {
  gate: SyncGate;
  pending: string[];
  allAcknowledged: boolean;
  isBlocking: boolean;
}

export interface AgentBlockCheck {
  blocked: boolean;
  blockingGates: SyncGate[];
}

// ── Use Cases ──────────────────────────────────────────

/**
 * Request a sync gate. Creates it in NEEDS_SYNC then immediately
 * transitions to SYNC_REQUESTED.
 */
export function sgRequest(input: SyncGateRequestInput): SyncGateStatusResult {
  const create: SyncGateCreate = {
    sessionId: input.sessionId ?? "",
    taskId: input.taskId,
    requestedByAgentId: input.requestedByAgentId,
    requiredAgentIds: input.requiredAgentIds,
    reason: (input.reason as SyncGateReason) ?? SyncGateReason.MANUAL_REQUEST,
    description: input.description ?? "",
    relatedFiles: input.relatedFiles ?? "",
    relatedResourcesJson: input.relatedResourcesJson ?? "",
    relatedCheckpointId: input.relatedCheckpointId ?? "",
    relatedClaimIds: input.relatedClaimIds ?? "",
  };

  let gate = repo.createSyncGate(create);

  logEvent(
    EventType.SYNC_GATE_CREATED,
    "sync_gate",
    gate.id,
    JSON.stringify({
      taskId: input.taskId,
      requiredAgentIds: input.requiredAgentIds,
      reason: input.reason ?? "manual_request",
    }),
  );

  // Auto-advance to SYNC_REQUESTED
  gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.SYNC_REQUESTED);

  logEvent(
    EventType.SYNC_GATE_REQUESTED,
    "sync_gate",
    gate.id,
    JSON.stringify({
      requiredAgentIds: input.requiredAgentIds,
      description: input.description ?? "",
    }),
  );

  return buildStatusResult(gate);
}

/**
 * Agent acknowledges a sync gate.
 */
export function sgAck(gateId: string, agentId: string, summary?: string): SyncGateStatusResult {
  let gate = repo.getSyncGate(gateId);

  // Verify agent is required
  const required = parseIdList(gate.requiredAgentIds);
  if (!required.includes(agentId)) {
    throw new Error(`Agent ${agentId} is not required for gate ${gateId}`);
  }

  // Verify gate is in SYNC_REQUESTED
  if (gate.status !== SyncGateStatus.SYNC_REQUESTED) {
    throw new Error(`Gate ${gateId} is not in SYNC_REQUESTED state (currently ${gate.status})`);
  }

  // Add to acked list
  const acked = parseIdList(gate.ackedAgentIds);
  if (!acked.includes(agentId)) {
    acked.push(agentId);
    gate = repo.updateSyncGateAckedAgents(gate.id, acked.join(","));
  }

  logEvent(
    EventType.SYNC_GATE_ACKED,
    "sync_gate",
    gate.id,
    JSON.stringify({ agentId, summary: summary ?? "" }),
  );

  // Auto-advance to SYNC_ACKED when all have acknowledged
  if (allAcked(gate)) {
    gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.SYNC_ACKED, summary ?? "");
  }

  return buildStatusResult(gate);
}

/**
 * Resolve a sync gate (→ READY_TO_CONTINUE). Can only be done after
 * SYNC_ACKED, or forced from SYNC_REQUESTED.
 */
export function sgResolve(gateId: string, decisionSummary?: string): SyncGateStatusResult {
  let gate = repo.getSyncGate(gateId);

  if (!validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.READY_TO_CONTINUE)) {
    throw new Error(`Cannot resolve gate ${gateId} from ${gate.status}`);
  }

  gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.READY_TO_CONTINUE, decisionSummary ?? "");

  logEvent(
    EventType.SYNC_GATE_RESOLVED,
    "sync_gate",
    gate.id,
    JSON.stringify({ decisionSummary: decisionSummary ?? "" }),
  );

  return buildStatusResult(gate);
}

/**
 * Cancel a sync gate.
 */
export function sgCancel(gateId: string, reason?: string): SyncGate {
  let gate = repo.getSyncGate(gateId);

  if (!validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.CANCELLED)) {
    throw new Error(`Cannot cancel gate ${gateId} from ${gate.status}`);
  }

  gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.CANCELLED, reason ?? "");

  logEvent(
    EventType.SYNC_GATE_CANCELLED,
    "sync_gate",
    gate.id,
    JSON.stringify({ reason: reason ?? "" }),
  );

  return gate;
}

/**
 * Get detailed gate status.
 */
export function sgStatus(gateId: string): SyncGateStatusResult {
  const gate = repo.getSyncGate(gateId);
  return buildStatusResult(gate);
}

/**
 * List all sync gates with optional filters.
 */
export function sgList(opts?: { taskId?: string; sessionId?: string; status?: string }): SyncGate[] {
  return repo.listSyncGates(opts);
}

/**
 * List active (blocking) sync gates.
 */
export function sgListActive(opts?: { taskId?: string; sessionId?: string }): SyncGate[] {
  return repo.listActiveSyncGates(opts);
}

/**
 * Check if an agent is blocked by any active sync gate.
 * This is the enforcement point — call before allowing resume/wake/start-work.
 */
export function sgCheckAgent(agentId: string, opts?: { taskId?: string; sessionId?: string }): AgentBlockCheck {
  const activeGates = repo.listActiveSyncGates(opts);
  const blockingGates = activeGates.filter(g => isAgentBlocked(g, agentId));
  return {
    blocked: blockingGates.length > 0,
    blockingGates,
  };
}

// ── Internal ───────────────────────────────────────────

function buildStatusResult(gate: SyncGate): SyncGateStatusResult {
  return {
    gate,
    pending: pendingAgents(gate),
    allAcknowledged: allAcked(gate),
    isBlocking:
      gate.status === SyncGateStatus.NEEDS_SYNC ||
      gate.status === SyncGateStatus.SYNC_REQUESTED ||
      gate.status === SyncGateStatus.SYNC_ACKED,
  };
}
