import { OrchestrationEventType, computeWakeTargets } from "syncpoint-governance";
import { EventType } from "syncpoint-kernel";
import type {
  WakeRequestCreate,
  WakeTarget,
  WakeContext,
} from "syncpoint-governance";
import { _getBus } from "../../repositories/_shared.js";
import type { SyncPointEventData } from "../../event-bus.js";
import {
  createWakeRequest,
  getReviewRequest,
  getSession,
  getTaskAssignment,
  hasActiveWakeForAgent,
  listRoles,
} from "../../repositories/_exports/orchestration.js";
import { logEvent } from "../../repositories/_shared.js";
import {
  ORCHESTRATION_EVENT_SET,
  parseSessionIdFromDetail,
  resolveTaskId,
  resolveReviewRequestId,
  mapActionToPrompt,
  mapActionToMcpTool,
  mapActionToCli,
} from "./helpers.js";
import { wakeEngineState } from "./state.js";
import type { WakeEngineOptions, WakeEngineStats } from "./types.js";

export function wakeEngineStart(options?: WakeEngineOptions): void {
  if (wakeEngineState.listener) return;

  wakeEngineState.options = { enabled: true, defaultRunnerMode: "manual", ...options };
  wakeEngineState.stats = { eventsProcessed: 0, wakeRequestsCreated: 0, wakeRequestsSkipped: 0, running: true };

  const bus = _getBus();
  wakeEngineState.listener = (data: SyncPointEventData) => {
    if (!wakeEngineState.options.enabled) return;
    if (wakeEngineState.processing) return;
    try {
      processEvent(data);
    } catch (err) {
      console.error("[WakeEngine] Error processing event:", err);
    }
  };
  bus.on("event", wakeEngineState.listener);
}

export function wakeEngineStop(): void {
  if (!wakeEngineState.listener) return;
  const bus = _getBus();
  bus.off("event", wakeEngineState.listener);
  wakeEngineState.listener = null;
  wakeEngineState.stats.running = false;
}

export function wakeEngineStats(): WakeEngineStats {
  return { ...wakeEngineState.stats };
}

export function processOrchestrationEvent(
  eventType: string,
  entityType: string,
  entityId: string,
  detail?: string,
): void {
  processEvent({
    seq: 0, // Internal event, not broadcast via SSE
    eventType,
    entityType,
    entityId,
    detail,
    timestamp: new Date().toISOString(),
  });
}

function processEvent(data: SyncPointEventData): void {
  wakeEngineState.stats.eventsProcessed++;

  if (!ORCHESTRATION_EVENT_SET.has(data.eventType)) return;

  const ctx = resolveSessionContext(data);
  if (!ctx) return;

  const targets = computeWakeTargets(ctx);

  for (const target of targets) {
    createWakeRequestsForTarget(ctx, target, data);
  }
}

function resolveSessionContext(data: SyncPointEventData): WakeContext | null {
  let sessionId: string | null = null;
  let sessionStatus: string | null = null;

  if (
    data.eventType === OrchestrationEventType.SESSION_CREATED ||
    data.eventType === OrchestrationEventType.SESSION_ADVANCED ||
    data.eventType === OrchestrationEventType.SESSION_CANCELLED
  ) {
    sessionId = data.entityId;
  }

  if (data.eventType === OrchestrationEventType.ROLE_ASSIGNED) {
    sessionId = parseSessionIdFromDetail(data.detail);
  }

  if (
    data.eventType === OrchestrationEventType.ASSIGNMENT_CREATED ||
    data.eventType === OrchestrationEventType.ASSIGNMENT_ACCEPTED ||
    data.eventType === OrchestrationEventType.ASSIGNMENT_STARTED ||
    data.eventType === OrchestrationEventType.ASSIGNMENT_COMPLETED
  ) {
    try {
      const assignment = getTaskAssignment(data.entityId);
      sessionId = assignment.sessionId;
    } catch { return null; }
  }

  if (
    data.eventType === OrchestrationEventType.REVIEW_REQUESTED ||
    data.eventType === OrchestrationEventType.REVIEW_STARTED ||
    data.eventType === OrchestrationEventType.REVIEW_DECIDED ||
    data.eventType === OrchestrationEventType.REVIEW_APPROVED ||
    data.eventType === OrchestrationEventType.REVIEW_BLOCKED
  ) {
    try {
      const review = getReviewRequest(data.entityId);
      sessionId = review.sessionId;
    } catch { return null; }
  }

  if (!sessionId) return null;

  try {
    const session = getSession(sessionId);
    sessionStatus = session.status;
    const roles = listRoles(sessionId);

    return {
      triggerEventType: data.eventType,
      sessionId,
      sessionStatus: sessionStatus!,
      roleBindings: roles.map(r => ({ agentId: r.agentId, role: r.role })),
      relationshipMode: (session as any).relationshipMode ?? undefined,
    };
  } catch {
    return null;
  }
}

function createWakeRequestsForTarget(
  ctx: WakeContext,
  target: WakeTarget,
  event: SyncPointEventData,
): void {
  const agents = ctx.roleBindings.filter(rb => rb.role === target.targetRole);

  for (const agent of agents) {
    if (hasActiveWakeForAgent(ctx.sessionId, agent.agentId, target.action)) {
      wakeEngineState.stats.wakeRequestsSkipped++;
      continue;
    }

    const taskId = resolveTaskId(event);
    const reviewRequestId = resolveReviewRequestId(event);

    const create: WakeRequestCreate = {
      sessionId: ctx.sessionId,
      targetAgentId: agent.agentId,
      targetRole: target.targetRole,
      action: target.action,
      reason: target.reason,
      triggerEventType: event.eventType,
      triggerEntityId: event.entityId,
      taskId,
      reviewRequestId,
      promptHint: mapActionToPrompt(target.action),
      mcpToolHint: mapActionToMcpTool(target.action),
      cliHint: mapActionToCli(target.action),
      runnerMode: wakeEngineState.options.defaultRunnerMode ?? "manual",
    };

    const created = createWakeRequest(create);
    wakeEngineState.stats.wakeRequestsCreated++;

    wakeEngineState.processing = true;
    try {
      logEvent(
        EventType.WAKE_CREATED,
        "wake_request",
        created.id,
        JSON.stringify({ sessionId: ctx.sessionId, targetAgentId: agent.agentId, action: target.action }),
      );
    } finally {
      wakeEngineState.processing = false;
    }
  }
}
