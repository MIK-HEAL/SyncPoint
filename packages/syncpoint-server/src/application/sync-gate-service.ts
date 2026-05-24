/**
 * SyncGate Service — synchronization barriers.
 *
 * Use cases:
 *   sgRequest    — create a sync gate and move it to SYNC_REQUESTED
 *   sgAck        — agent acknowledges a gate
 *   sgVote       — agent votes on a gate (approve/reject/abstain/escalate)
 *   sgReconcile  — evaluate liveness and apply state transitions
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
  isGateBlocking,
  hasPartialAcks,
  parseIdList,
  parseGatePolicy,
  evaluateGateLiveness,
  detectResourceClaimConflicts,
  LivenessAction,
  GateVoteKind,
  computeGateDetails,
  computeAvailableActions,
} from "syncpoint-core";
import type { SyncGate, SyncGateCreate, GatePolicy, GateVote, GateVoteCreate, LivenessDecision, GateDetailedStatus, GateAction, ResourceRef } from "syncpoint-core";
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
  relatedFiles?: string[];
  relatedResources?: ResourceRef[];
  relatedCheckpointId?: string;
  relatedClaimIds?: string[];
  policy?: GatePolicy;
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
    relatedFiles: input.relatedFiles ?? [],
    relatedResources: input.relatedResources ?? [],
    relatedCheckpointId: input.relatedCheckpointId ?? "",
    relatedClaimIds: input.relatedClaimIds ?? [],
    policy: input.policy,
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

  // Verify gate is in a state that accepts acks
  if (
    gate.status !== SyncGateStatus.SYNC_REQUESTED &&
    gate.status !== SyncGateStatus.PARTIALLY_ACKED
  ) {
    throw new Error(`Gate ${gateId} is not in SYNC_REQUESTED or PARTIALLY_ACKED state (currently ${gate.status})`);
  }

  // Add to acked list (separate ack table, never overwrites governance votes)
  const acked = parseIdList(gate.ackedAgentIds);
  if (!acked.includes(agentId)) {
    repo.createGateAck({
      gateId: gate.id,
      agentId,
      summary: summary ?? "",
    });
    gate = repo.getSyncGate(gate.id);
  }

  logEvent(
    EventType.SYNC_GATE_ACKED,
    "sync_gate",
    gate.id,
    JSON.stringify({ agentId, summary: summary ?? "" }),
  );

  // Auto-advance status based on ack progress
  if (allAcked(gate)) {
    gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.SYNC_ACKED, summary ?? "");
  } else if (hasPartialAcks(gate) && gate.status === SyncGateStatus.SYNC_REQUESTED) {
    gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.PARTIALLY_ACKED);
  }

  // Run reconcile after ack — quorum/liveness policies may now be satisfied
  return sgReconcile(gate.id);
}

/**
 * Cast a vote on a sync gate. Votes are separate from acks:
 * ack = "I see it", vote = "I think we should approve/reject/escalate".
 *
 * Governance:
 *   - Only required agents or escalation agents may vote.
 *   - Vote kind must be a valid GateVoteKind.
 *   - Duplicate votes update the agent's position (last vote wins at count time).
 */
export function sgVote(gateId: string, agentId: string, vote: string, summary?: string): SyncGateStatusResult {
  const gate = repo.getSyncGate(gateId);
  if (!isGateBlocking(gate)) {
    throw new Error(`Gate ${gateId} is already resolved (${gate.status})`);
  }

  // Validate vote kind
  const validKinds = [
    GateVoteKind.APPROVE,
    GateVoteKind.REJECT,
    GateVoteKind.ABSTAIN,
    GateVoteKind.ESCALATE,
  ] as string[];
  if (!validKinds.includes(vote)) {
    throw new Error(`Invalid vote kind "${vote}". Must be one of: ${validKinds.join(", ")}`);
  }

  // Validate voter eligibility: must be a required agent or escalation agent
  const policy = parseGatePolicy(gate);
  const requiredAgents = parseIdList(gate.requiredAgentIds);
  const escalationAgents = policy.escalationAgentIds ?? [];
  const eligible = new Set([...requiredAgents, ...escalationAgents, gate.requestedByAgentId]);
  if (!eligible.has(agentId)) {
    throw new Error(`Agent ${agentId} is not eligible to vote on gate ${gateId}. Eligible: required, escalation, or owner agents.`);
  }

  const voteData: GateVoteCreate = {
    gateId,
    agentId,
    vote: vote as GateVoteKind,
    summary: summary ?? "",
  };
  repo.createGateVote(voteData);

  logEvent(
    EventType.SYNC_GATE_ACKED,
    "sync_gate",
    gateId,
    JSON.stringify({ agentId, vote, summary: summary ?? "", type: "vote" }),
  );

  // Run reconcile after vote to see if policy is satisfied
  return sgReconcile(gateId);
}

/**
 * Evaluate gate liveness and apply resulting state transitions.
 * Called lazily before sgCheckAgent, wakeNext, loopResume,
 * and eagerly after sgAck, sgVote, rcRelease.
 */
export function sgReconcile(gateId: string): SyncGateStatusResult {
  let gate = repo.getSyncGate(gateId);
  if (!isGateBlocking(gate)) return buildStatusResult(gate);

  const votes = repo.listGateVotes(gateId);
  const decision = evaluateGateLiveness(gate, votes, new Date());

  switch (decision.action) {
    case LivenessAction.AUTO_RESOLVE:
      if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.READY_TO_CONTINUE)) {
        gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.READY_TO_CONTINUE, decision.reason);
        logEvent(EventType.SYNC_GATE_RESOLVED, "sync_gate", gate.id,
          JSON.stringify({ reason: decision.reason, auto: true }));
      }
      break;

    case LivenessAction.ALLOW_QUORUM_RESOLVE:
      if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.READY_TO_CONTINUE)) {
        gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.READY_TO_CONTINUE, decision.reason);
        logEvent(EventType.SYNC_GATE_RESOLVED, "sync_gate", gate.id,
          JSON.stringify({ reason: decision.reason, quorum: true }));
      }
      break;

    case LivenessAction.ESCALATE:
      if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.ESCALATED)) {
        gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.ESCALATED, decision.reason);
        logEvent(EventType.SYNC_GATE_REQUESTED, "sync_gate", gate.id,
          JSON.stringify({ escalatedTo: decision.escalateTo, reason: decision.reason }));
      }
      break;

    case LivenessAction.ALLOW_CANCEL:
      if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.CANCELLED)) {
        gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.CANCELLED, decision.reason);
        logEvent(EventType.SYNC_GATE_CANCELLED, "sync_gate", gate.id,
          JSON.stringify({ reason: decision.reason }));
      }
      break;

    case LivenessAction.REQUIRE_HUMAN_OVERRIDE:
      if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.TIMED_OUT)) {
        gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.TIMED_OUT, decision.reason);
      } else if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.ESCALATED)) {
        gate = repo.updateSyncGateStatus(gate.id, SyncGateStatus.ESCALATED, decision.reason);
      }
      break;

    case LivenessAction.CONTINUE_BLOCKING:
    default:
      // No state change
      break;
  }

  return buildStatusResult(gate);
}

/**
 * Reconcile all active gates related to specific claim IDs.
 * Called when claims are released to auto-resolve conflict gates.
 *
 * For resource_conflict gates: re-checks whether the underlying
 * claim conflict still exists. If not, auto-resolves the gate.
 */
export function sgReconcileForClaims(claimIds: string[]): void {
  const gates = repo.listGatesByRelatedClaimIds(claimIds);
  for (const gate of gates) {
    if (!isGateBlocking(gate)) continue;

    // For resource_conflict gates, re-evaluate whether the conflict persists
    if (gate.reason === SyncGateReason.RESOURCE_CONFLICT && gate.relatedClaimIds.length > 0) {
      const relatedIds = gate.relatedClaimIds;
      // Gather all still-active claims referenced by this gate
      const activeClaims = relatedIds
        .map(id => { try { return repo.getResourceClaim(id); } catch { return null; } })
        .filter((c): c is NonNullable<typeof c> => c != null && c.status === "ACTIVE");

      // Re-run conflict detection on remaining active claims
      const conflicts = detectResourceClaimConflicts(activeClaims);
      if (conflicts.length === 0) {
        // Conflict resolved — auto-resolve gate if transition is valid
        if (validateSyncGateTransition(gate.status as SyncGateStatus, SyncGateStatus.READY_TO_CONTINUE)) {
          repo.updateSyncGateStatus(gate.id, SyncGateStatus.READY_TO_CONTINUE, "Resource conflict resolved (claims released)");
          logEvent(EventType.SYNC_GATE_RESOLVED, "sync_gate", gate.id,
            JSON.stringify({ reason: "conflict_resolved", auto: true }));
          continue;
        }
      }
    }

    // Fallback: run normal liveness reconcile
    sgReconcile(gate.id);
  }
}

/**
 * Resolve a sync gate (→ READY_TO_CONTINUE). Can be done from
 * SYNC_ACKED, ESCALATED, TIMED_OUT, or BYPASS_REQUESTED.
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
 * Performs lazy reconcile to ensure returned state reflects current liveness.
 */
export function sgStatus(gateId: string): SyncGateStatusResult {
  return sgReconcile(gateId);
}

/**
 * Get full detailed gate status with policy, votes, eligible voters, actions.
 * Performs lazy reconcile first. If agentId provided, includes availableActions for that agent.
 */
export function sgStatusDetailed(gateId: string, agentId?: string): GateDetailedStatus & { availableActions?: GateAction[] } {
  sgReconcile(gateId);
  const gate = repo.getSyncGate(gateId);
  const votes = repo.listGateVotes(gateId);
  const details = computeGateDetails(gate, votes);
  if (agentId) {
    return { ...details, availableActions: computeAvailableActions(gate, agentId, votes) };
  }
  return details;
}

/**
 * List all sync gates with optional filters.
 */
export function sgList(opts?: { taskId?: string; sessionId?: string; status?: string }): SyncGate[] {
  return repo.listSyncGates(opts);
}

/**
 * List active (blocking) sync gates.
 * Performs lazy reconcile on all active gates first.
 */
export function sgListActive(opts?: { taskId?: string; sessionId?: string }): SyncGate[] {
  sgReconcileActive(opts);
  return repo.listActiveSyncGates(opts);
}

/**
 * Batch reconcile all active gates matching the given filters.
 * Shared entry point for sgListActive, sgCheckAgent, snapshot, and background tick.
 */
export function sgReconcileActive(opts?: { taskId?: string; sessionId?: string }): void {
  const activeGates = repo.listActiveSyncGates(opts);
  for (const g of activeGates) {
    sgReconcile(g.id);
  }
}

/**
 * Check if an agent is blocked by any active sync gate.
 * This is the enforcement point — call before allowing resume/wake/start-work.
 */
export function sgCheckAgent(agentId: string, opts?: { taskId?: string; sessionId?: string }): AgentBlockCheck {
  // Lazy reconcile: evaluate liveness for all active gates
  sgReconcileActive(opts);

  // Re-fetch after reconcile — some gates may have been resolved
  const refreshedGates = repo.listActiveSyncGates(opts);
  const blockingGates = refreshedGates.filter(g => isAgentBlocked(g, agentId));
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
    isBlocking: isGateBlocking(gate),
  };
}
