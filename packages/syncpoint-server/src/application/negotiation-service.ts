/**
 * Negotiation Service — orchestrates negotiation sessions bound to sync gates.
 *
 * API:
 *   negStart(gateId, participantIds, config?)  — create session, start round 1
 *   negMessage(sessionId, agentId, kind, content) — post message
 *   negReconcile(sessionId) — evaluate liveness, advance/deadlock/timeout
 *   negResolve(sessionId, agentId, summary) — human/owner resolves
 *   negStatus(sessionId) — detailed status with messages
 */

import {
  NegotiationStatus,
  NegotiationMessageKind,
  DEFAULT_NEGOTIATION_CONFIG,
  validateNegotiationTransition,
  evaluateNegotiation,
} from "syncpoint-adapters";
import type { NegotiationConfig, NegotiationSession, NegotiationMessage } from "syncpoint-adapters";
import * as repo from "../repositories/negotiation-repository.js";
import { sgResolve as gateResolve } from "./sync-gate-service.js";
import { updateSyncGateStatus, getSyncGate } from "../repositories/sync-gate-repository.js";
import { ConstraintViolationError, ForbiddenError, InvalidStateTransitionError, ResourceNotFoundError, ValidationError, SyncGateStatus, isGateBlocking, validateSyncGateTransition } from "syncpoint-kernel";

/**
 * Safe gate writeback — only writes if the gate is still blocking and the
 * transition is valid. Prevents regressing an already-resolved gate.
 */
function safeGateTransition(gateId: string, target: SyncGateStatus, summary: string): void {
  try {
    const gate = getSyncGate(gateId);
    if (!isGateBlocking(gate)) return;
    if (!validateSyncGateTransition(gate.status as SyncGateStatus, target)) return;
    updateSyncGateStatus(gateId, target, summary);
  } catch { /* gate may not exist or other error — swallow */ }
}

// ── Start ────────────────────────────────────────────

export function negStart(
  gateId: string,
  participantIds: string[],
  config?: Partial<NegotiationConfig>,
) {
  if (participantIds.length < 2) {
    throw new ValidationError("participantIds", "Negotiation requires at least 2 participants");
  }

  const existing = repo.getNegotiationSessionByGate(gateId);
  if (existing && existing.status !== NegotiationStatus.RESOLVED && existing.status !== NegotiationStatus.ESCALATED) {
    throw new ConstraintViolationError(["negotiation_unique_gate"], `Active negotiation already exists for gate ${gateId}: ${existing.id}`);
  }

  const merged: NegotiationConfig = { ...DEFAULT_NEGOTIATION_CONFIG, ...config };
  const deadlineAt = new Date(Date.now() + merged.negotiationDeadlineMinutes * 60_000).toISOString();

  const session = repo.createNegotiationSession({
    gateId,
    participantIds,
    configJson: merged,
    deadlineAt,
  });

  // Immediately advance to ROUND_ACTIVE round 1
  const updated = repo.updateNegotiationSession(session.id, {
    status: NegotiationStatus.ROUND_ACTIVE,
    currentRound: 1,
    roundStartedAt: new Date().toISOString(),
  });

  return updated;
}

// ── Post message ─────────────────────────────────────

export function negMessage(
  sessionId: string,
  agentId: string,
  kind: string,
  content: string,
) {
  const session = repo.getNegotiationSession(sessionId);
  if (!session) throw new ResourceNotFoundError(sessionId);

  // Validate kind
  const validKinds = Object.values(NegotiationMessageKind) as string[];
  if (!validKinds.includes(kind.toUpperCase())) {
    throw new ValidationError("kind", `Invalid message kind: ${kind}. Valid: ${validKinds.join(", ")}`);
  }

  // Must be active
  if (
    session.status !== NegotiationStatus.ROUND_ACTIVE &&
    session.status !== NegotiationStatus.WAITING_FOR_RESPONSES
  ) {
    throw new InvalidStateTransitionError("negotiation", session.status, NegotiationStatus.ROUND_ACTIVE);
  }

  // Must be a participant
  const participants = session.participantIds;
  if (!participants.includes(agentId)) {
    throw new ForbiddenError("neg_message", `Agent ${agentId} is not a participant in this negotiation`);
  }

  const msg = repo.createNegotiationMessage({
    sessionId,
    agentId,
    round: session.currentRound,
    kind: kind.toUpperCase(),
    content,
  });

  // After posting, check if all participants have responded → transition to WAITING_FOR_RESPONSES
  const messages = repo.listNegotiationMessages(sessionId) as NegotiationMessage[];
  const currentRoundMessages = messages.filter(m => m.round === session.currentRound);
  const responded = new Set(currentRoundMessages.map(m => m.agentId));

  if (
    responded.size >= participants.length &&
    session.status === NegotiationStatus.ROUND_ACTIVE
  ) {
    repo.updateNegotiationSession(sessionId, {
      status: NegotiationStatus.WAITING_FOR_RESPONSES,
    });
  }

  return { message: msg, session: repo.getNegotiationSession(sessionId)! };
}

// ── Reconcile (liveness evaluation) ──────────────────

export function negReconcile(sessionId: string) {
  const session = repo.getNegotiationSession(sessionId);
  if (!session) throw new ResourceNotFoundError(sessionId);

  // Terminal states — nothing to do
  if (
    session.status === NegotiationStatus.RESOLVED ||
    session.status === NegotiationStatus.ESCALATED
  ) {
    return { session, action: "none" as const, reason: "Terminal state" };
  }

  const messages = repo.listNegotiationMessages(sessionId) as NegotiationMessage[];
  const result = evaluateNegotiation(session as NegotiationSession, messages);

  switch (result.action) {
    case "resolved": {
      const updated = repo.updateNegotiationSession(sessionId, {
        status: NegotiationStatus.RESOLVED,
        resolutionSummary: result.reason,
      });
      // Write back to parent gate: resolve it
      try { gateResolve(session.gateId, `Negotiation resolved: ${result.reason}`); } catch { /* gate may already be resolved */ }
      return { session: updated, action: result.action, reason: result.reason };
    }
    case "timeout": {
      const updated = repo.updateNegotiationSession(sessionId, {
        status: NegotiationStatus.TIMED_OUT,
      });
      // Write back to parent gate: mark timed out
      safeGateTransition(session.gateId, SyncGateStatus.TIMED_OUT, `Negotiation timed out: ${result.reason}`);
      return { session: updated, action: result.action, reason: result.reason };
    }
    case "deadlock": {
      const updated = repo.updateNegotiationSession(sessionId, {
        status: NegotiationStatus.DEADLOCKED,
      });
      // Write back to parent gate: escalate on deadlock
      safeGateTransition(session.gateId, SyncGateStatus.ESCALATED, `Negotiation deadlocked: ${result.reason}`);
      return { session: updated, action: result.action, reason: result.reason };
    }
    case "advance_round": {
      const newRound = session.currentRound + 1;
      const updated = repo.updateNegotiationSession(sessionId, {
        status: NegotiationStatus.ROUND_ACTIVE,
        currentRound: newRound,
        roundStartedAt: new Date().toISOString(),
      });
      return { session: updated, action: result.action, reason: result.reason };
    }
    default:
      return { session, action: result.action, reason: result.reason };
  }
}

// ── Human resolve ────────────────────────────────────

export function negResolve(sessionId: string, agentId: string, summary: string) {
  const session = repo.getNegotiationSession(sessionId);
  if (!session) throw new ResourceNotFoundError(sessionId);

  // Can resolve from DEADLOCKED, TIMED_OUT, ESCALATED, or active states
  if (session.status === NegotiationStatus.RESOLVED) {
    throw new InvalidStateTransitionError("negotiation", NegotiationStatus.RESOLVED, "non_resolved");
  }

  const updated = repo.updateNegotiationSession(sessionId, {
    status: NegotiationStatus.RESOLVED,
    resolvedByAgentId: agentId,
    resolutionSummary: summary,
  });

  // Write back to parent gate: resolve it
  try { gateResolve(session.gateId, `Negotiation resolved by ${agentId}: ${summary}`); } catch { /* gate may already be resolved */ }

  return updated;
}

// ── Escalate ─────────────────────────────────────────

export function negEscalate(sessionId: string) {
  const session = repo.getNegotiationSession(sessionId);
  if (!session) throw new ResourceNotFoundError(sessionId);

  if (!validateNegotiationTransition(session.status as NegotiationStatus, NegotiationStatus.ESCALATED)) {
    throw new InvalidStateTransitionError("negotiation", session.status, NegotiationStatus.ESCALATED);
  }

  const updated = repo.updateNegotiationSession(sessionId, {
    status: NegotiationStatus.ESCALATED,
  });

  // Write back to parent gate: escalate
  safeGateTransition(session.gateId, SyncGateStatus.ESCALATED, "Negotiation escalated");

  return updated;
}

// ── Status ───────────────────────────────────────────

export function negStatus(sessionId: string) {
  // Lazy reconcile
  const reconciled = negReconcile(sessionId);

  const messages = repo.listNegotiationMessages(sessionId) as NegotiationMessage[];
  const session = reconciled.session;
  const participants = session.participantIds;
  const currentRoundMessages = messages.filter(m => m.round === session.currentRound);
  const responded = new Set(currentRoundMessages.map(m => m.agentId));
  const pendingParticipants = participants.filter(p => !responded.has(p));

  return {
    session,
    messages,
    currentRound: session.currentRound,
    respondedAgentIds: [...responded],
    pendingParticipantIds: pendingParticipants,
    totalMessages: messages.length,
    lastAction: reconciled.action,
    lastReason: reconciled.reason,
  };
}
