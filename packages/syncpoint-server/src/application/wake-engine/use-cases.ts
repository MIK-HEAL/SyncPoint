import { WakeRequestStatus, EventType } from "syncpoint-core";
import type { WakeRequest } from "syncpoint-core";
import {
  getWakeRequest,
  listQueuedWakeRequests,
  listWakeRequests,
  listWakeRequestsByAgent,
  updateWakeRequestStatus,
} from "../../repositories/_exports/orchestration.js";
import { logEvent } from "../../repositories/_shared.js";
import { collaborationCoordinator } from "../collaboration-coordinator.js";
import { wakeEngineState } from "./state.js";
import type { WakeListInput } from "./types.js";

export function wakeList(input: WakeListInput): WakeRequest[] {
  if (input.agentId) {
    const all = listWakeRequestsByAgent(input.agentId);
    if (input.status) return all.filter(w => w.status === input.status);
    return all;
  }
  if (input.sessionId) {
    const all = listWakeRequests(input.sessionId);
    if (input.status) return all.filter(w => w.status === input.status);
    return all;
  }
  return listQueuedWakeRequests();
}

export function wakeGet(id: string): WakeRequest {
  return getWakeRequest(id);
}

export function wakeAck(id: string): WakeRequest {
  return updateWakeRequestStatus(id, WakeRequestStatus.DISPATCHED);
}

export function wakeStart(id: string): WakeRequest {
  const wr = getWakeRequest(id);
  const blockCheck = collaborationCoordinator.execution.checkAgentBlock({
    agentId: wr.targetAgentId,
    taskId: wr.taskId ?? undefined,
    sessionId: wr.sessionId,
  });
  if (blockCheck.blocked) {
    const gateIds = blockCheck.blockingGates.map(g => g.id).join(", ");
    throw new Error(`Agent blocked by sync gate(s): ${gateIds}. Acknowledge before starting wake.`);
  }

  if (wr.taskId) {
    try {
      const decision = collaborationCoordinator.execution.evaluateReadiness({
        agentId: wr.targetAgentId,
        taskId: wr.taskId,
        action: "wake_start",
      }).constraintDecision;
      if (!decision.permitted) {
        const reasons = decision.blockers.map(b => b.message).join("; ");
        throw new Error(`Constraint violation: ${reasons}`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Constraint violation:")) throw err;
      throw new Error(`Cannot start wake: projection unavailable (${err instanceof Error ? err.message : "unknown error"})`);
    }
  }

  return updateWakeRequestStatus(id, WakeRequestStatus.RUNNING);
}

export function wakeDone(id: string, resultSummary?: string): WakeRequest {
  const wr = updateWakeRequestStatus(id, WakeRequestStatus.DONE, resultSummary);
  wakeEngineState.processing = true;
  try { logEvent(EventType.WAKE_DONE, "wake_request", id, resultSummary ?? ""); } finally { wakeEngineState.processing = false; }
  return wr;
}

export function wakeFail(id: string, resultSummary?: string): WakeRequest {
  const wr = updateWakeRequestStatus(id, WakeRequestStatus.FAILED, resultSummary);
  wakeEngineState.processing = true;
  try { logEvent(EventType.WAKE_FAILED, "wake_request", id, resultSummary ?? ""); } finally { wakeEngineState.processing = false; }
  return wr;
}

export function wakeSkip(id: string, resultSummary?: string): WakeRequest {
  return updateWakeRequestStatus(id, WakeRequestStatus.SKIPPED, resultSummary);
}

export function wakeNext(agentId: string): WakeRequest | null {
  const blockCheck = collaborationCoordinator.execution.checkAgentBlock({ agentId });
  if (blockCheck.blocked) return null;

  const all = listWakeRequestsByAgent(agentId);
  const queued = all.filter(w => w.status === WakeRequestStatus.QUEUED);
  if (queued.length === 0) return null;

  const wr = queued[0];
  if (wr.taskId) {
    try {
      const decision = collaborationCoordinator.execution.evaluateReadiness({
        agentId: wr.targetAgentId,
        taskId: wr.taskId,
        action: "wake_start",
      }).constraintDecision;
      if (!decision.permitted) return null;
    } catch { return null; }
  }

  return wr;
}
