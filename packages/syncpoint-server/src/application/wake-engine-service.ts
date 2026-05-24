/**
 * Wake Engine Service — event-driven auto-wake orchestration.
 *
 * Listens to EventBus events, resolves which session they belong to,
 * computes wake targets using the pure core engine, and creates WakeRequests.
 *
 * This is the runtime that turns SyncPoint from "tell me what to do next"
 * into "automatically generate who should be woken, with what context."
 */

import {
  OrchestrationEventType,
  WakeRequestStatus,
  computeWakeTargets,
} from "syncpoint-core";
import type {
  WakeRequest,
  WakeRequestCreate,
  WakeTarget,
  WakeContext,
} from "syncpoint-core";
import { SyncPointEventBus } from "../event-bus.js";
import type { SyncPointEventData } from "../event-bus.js";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import "./_scope-matchers.js";
import { EventType } from "syncpoint-core";
import { sgCheckAgent } from "./sync-gate-service.js";
import { evaluateExecutionReadiness } from "./collaboration-coordinator.js";

// ── Types ──────────────────────────────────────────────

export interface WakeEngineOptions {
  /** Enable/disable the engine (default: true) */
  enabled?: boolean;
  /** Default runner mode for generated WakeRequests */
  defaultRunnerMode?: "manual" | "mcp";
}

export interface WakeEngineStats {
  eventsProcessed: number;
  wakeRequestsCreated: number;
  wakeRequestsSkipped: number;
  running: boolean;
}

// ── Service State ──────────────────────────────────────

let _listener: ((data: SyncPointEventData) => void) | null = null;
let _stats: WakeEngineStats = {
  eventsProcessed: 0,
  wakeRequestsCreated: 0,
  wakeRequestsSkipped: 0,
  running: false,
};
let _options: WakeEngineOptions = { enabled: true, defaultRunnerMode: "manual" };

/** Guard to prevent re-entrant wake processing from logEvent → EventBus → processEvent loop */
let _processing = false;

// ── Start / Stop ───────────────────────────────────────

/**
 * Start the wake engine. Subscribes to the event bus and processes events.
 * This is optional — processOrchestrationEvent() can also be called directly.
 */
export function wakeEngineStart(options?: WakeEngineOptions): void {
  if (_listener) return; // already running

  _options = { enabled: true, defaultRunnerMode: "manual", ...options };
  _stats = { eventsProcessed: 0, wakeRequestsCreated: 0, wakeRequestsSkipped: 0, running: true };

  const bus = SyncPointEventBus.getInstance();
  _listener = (data: SyncPointEventData) => {
    if (!_options.enabled) return;
    if (_processing) return; // prevent re-entrant loop
    try {
      processEvent(data);
    } catch (err) {
      // Don't crash the server on wake engine errors
      console.error("[WakeEngine] Error processing event:", err);
    }
  };
  bus.on("event", _listener);
}

/**
 * Stop the wake engine.
 */
export function wakeEngineStop(): void {
  if (!_listener) return;
  const bus = SyncPointEventBus.getInstance();
  bus.off("event", _listener);
  _listener = null;
  _stats.running = false;
}

/**
 * Get engine stats.
 */
export function wakeEngineStats(): WakeEngineStats {
  return { ..._stats };
}

// ── Event Processing ───────────────────────────────────

/**
 * Map known orchestration event types to their entity type prefix.
 * Events that don't match are ignored (non-orchestration events).
 */
const ORCHESTRATION_EVENT_SET = new Set<string>(
  Object.values(OrchestrationEventType),
);

/**
 * Process an orchestration event and generate WakeRequests.
 *
 * **This is the primary entry point for wake generation.**
 * Called directly from orchestration-service after each action,
 * making it work in ALL entry points (HTTP server, MCP stdio, CLI, tests).
 *
 * Also called by the EventBus listener (wakeEngineStart) as a secondary path
 * for events not originating from orchestration-service.
 */
export function processOrchestrationEvent(
  eventType: string,
  entityType: string,
  entityId: string,
  detail?: string,
): void {
  processEvent({ eventType, entityType, entityId, detail });
}

function processEvent(data: SyncPointEventData): void {
  _stats.eventsProcessed++;

  // Only react to orchestration events
  if (!ORCHESTRATION_EVENT_SET.has(data.eventType)) return;

  // Resolve session context from the event
  const ctx = resolveSessionContext(data);
  if (!ctx) return;

  // Compute wake targets
  const targets = computeWakeTargets(ctx);

  // Create wake requests for each target
  for (const target of targets) {
    createWakeRequestsForTarget(ctx, target, data);
  }
}

/**
 * Given an event, resolve the session context needed for wake computation.
 * Extracts sessionId from the entity or detail, loads session + roles.
 */
function resolveSessionContext(data: SyncPointEventData): WakeContext | null {
  let sessionId: string | null = null;
  let sessionStatus: string | null = null;

  // For session events, the entityId IS the session ID
  if (
    data.eventType === OrchestrationEventType.SESSION_CREATED ||
    data.eventType === OrchestrationEventType.SESSION_ADVANCED ||
    data.eventType === OrchestrationEventType.SESSION_CANCELLED
  ) {
    sessionId = data.entityId;
  }

  // For role events, entityId is role profile id — parse sessionId from detail
  if (data.eventType === OrchestrationEventType.ROLE_ASSIGNED) {
    sessionId = parseSessionIdFromDetail(data.detail);
  }

  // For assignment events, entityId is assignment ID — look up session
  if (
    data.eventType === OrchestrationEventType.ASSIGNMENT_CREATED ||
    data.eventType === OrchestrationEventType.ASSIGNMENT_ACCEPTED ||
    data.eventType === OrchestrationEventType.ASSIGNMENT_STARTED ||
    data.eventType === OrchestrationEventType.ASSIGNMENT_COMPLETED
  ) {
    try {
      const assignment = repo.getTaskAssignment(data.entityId);
      sessionId = assignment.sessionId;
    } catch { return null; }
  }

  // For review events, entityId is review request ID — look up session
  if (
    data.eventType === OrchestrationEventType.REVIEW_REQUESTED ||
    data.eventType === OrchestrationEventType.REVIEW_STARTED ||
    data.eventType === OrchestrationEventType.REVIEW_DECIDED ||
    data.eventType === OrchestrationEventType.REVIEW_APPROVED ||
    data.eventType === OrchestrationEventType.REVIEW_BLOCKED
  ) {
    try {
      const review = repo.getReviewRequest(data.entityId);
      sessionId = review.sessionId;
    } catch { return null; }
  }

  if (!sessionId) return null;

  // Load session and roles
  try {
    const session = repo.getSession(sessionId);
    sessionStatus = session.status;
    const roles = repo.listRoles(sessionId);

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

/**
 * Create WakeRequests for a specific target.
 * Resolves role → agent(s), deduplicates against existing QUEUED requests.
 */
function createWakeRequestsForTarget(
  ctx: WakeContext,
  target: WakeTarget,
  event: SyncPointEventData,
): void {
  // Find all agents with this role in the session
  const agents = ctx.roleBindings.filter(rb => rb.role === target.targetRole);

  for (const agent of agents) {
    // Skip if there's already a QUEUED wake for this agent + action
    if (repo.hasActiveWakeForAgent(ctx.sessionId, agent.agentId, target.action)) {
      _stats.wakeRequestsSkipped++;
      continue;
    }

    // Resolve task ID and review request ID context
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
      runnerMode: _options.defaultRunnerMode ?? "manual",
    };

    const created = repo.createWakeRequest(create);
    _stats.wakeRequestsCreated++;

    // Write to event log + SSE so clients can react in real time
    _processing = true;
    try {
      logEvent(
        EventType.WAKE_CREATED,
        "wake_request",
        created.id,
        JSON.stringify({ sessionId: ctx.sessionId, targetAgentId: agent.agentId, action: target.action }),
      );
    } finally {
      _processing = false;
    }
  }
}

// ── Use Cases (called by CLI / MCP / tRPC) ─────────────

export interface WakeListInput {
  sessionId?: string;
  agentId?: string;
  status?: string;
}

export function wakeList(input: WakeListInput): WakeRequest[] {
  if (input.agentId) {
    const all = repo.listWakeRequestsByAgent(input.agentId);
    if (input.status) return all.filter(w => w.status === input.status);
    return all;
  }
  if (input.sessionId) {
    const all = repo.listWakeRequests(input.sessionId);
    if (input.status) return all.filter(w => w.status === input.status);
    return all;
  }
  return repo.listQueuedWakeRequests();
}

export function wakeGet(id: string): WakeRequest {
  return repo.getWakeRequest(id);
}

export function wakeAck(id: string): WakeRequest {
  return repo.updateWakeRequestStatus(id, WakeRequestStatus.DISPATCHED);
}

export function wakeStart(id: string): WakeRequest {
  // SyncGate hard gate — block start if agent has unacknowledged gates
  const wr = repo.getWakeRequest(id);
  const blockCheck = sgCheckAgent(wr.targetAgentId, { taskId: wr.taskId ?? undefined });
  if (blockCheck.blocked) {
    const gateIds = blockCheck.blockingGates.map(g => g.id).join(", ");
    throw new Error(`Agent blocked by sync gate(s): ${gateIds}. Acknowledge before starting wake.`);
  }

  // P4C: Constraint Runtime enforcement
  if (wr.taskId) {
    try {
      const decision = evaluateExecutionReadiness({
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
      // Fail-closed: projection unavailable — block wake start
      throw new Error(`Cannot start wake: projection unavailable (${err instanceof Error ? err.message : "unknown error"})`);
    }
  }

  return repo.updateWakeRequestStatus(id, WakeRequestStatus.RUNNING);
}

export function wakeDone(id: string, resultSummary?: string): WakeRequest {
  const wr = repo.updateWakeRequestStatus(id, WakeRequestStatus.DONE, resultSummary);
  _processing = true;
  try { logEvent(EventType.WAKE_DONE, "wake_request", id, resultSummary ?? ""); } finally { _processing = false; }
  return wr;
}

export function wakeFail(id: string, resultSummary?: string): WakeRequest {
  const wr = repo.updateWakeRequestStatus(id, WakeRequestStatus.FAILED, resultSummary);
  _processing = true;
  try { logEvent(EventType.WAKE_FAILED, "wake_request", id, resultSummary ?? ""); } finally { _processing = false; }
  return wr;
}

export function wakeSkip(id: string, resultSummary?: string): WakeRequest {
  return repo.updateWakeRequestStatus(id, WakeRequestStatus.SKIPPED, resultSummary);
}

/**
 * Get the next QUEUED wake request for a specific agent.
 * Used by MCP/editor agents to poll for work.
 * Returns null if the agent is blocked by a sync gate.
 */
export function wakeNext(agentId: string): WakeRequest | null {
  // SyncGate hard gate — if agent is blocked, return null (no wake dispatched)
  const blockCheck = sgCheckAgent(agentId);
  if (blockCheck.blocked) return null;

  const all = repo.listWakeRequestsByAgent(agentId);
  const queued = all.filter(w => w.status === WakeRequestStatus.QUEUED);
  if (queued.length === 0) return null;

  // P4C: Constraint Runtime enforcement — skip wake if constraint-blocked
  const wr = queued[0];
  if (wr.taskId) {
    try {
      const decision = evaluateExecutionReadiness({
        agentId: wr.targetAgentId,
        taskId: wr.taskId,
        action: "wake_start",
      }).constraintDecision;
      if (!decision.permitted) return null;
    } catch { /* Fail-closed: projection unavailable — skip this wake */ return null; }
  }

  return wr;
}

// ── Helpers ────────────────────────────────────────────

function parseSessionIdFromDetail(detail?: string): string | null {
  if (!detail) return null;
  // detail format: "sessionId:xxx" or JSON
  try {
    const parsed = JSON.parse(detail);
    return parsed.sessionId ?? null;
  } catch {
    // Try simple "sessionId:xxx" format
    if (detail.startsWith("session:")) return detail.slice(8);
    return detail;
  }
}

function resolveTaskId(event: SyncPointEventData): string | null {
  // For assignment events, look up the task
  if (
    event.eventType === OrchestrationEventType.ASSIGNMENT_CREATED ||
    event.eventType === OrchestrationEventType.ASSIGNMENT_ACCEPTED ||
    event.eventType === OrchestrationEventType.ASSIGNMENT_STARTED ||
    event.eventType === OrchestrationEventType.ASSIGNMENT_COMPLETED
  ) {
    try {
      const assignment = repo.getTaskAssignment(event.entityId);
      return assignment.taskId;
    } catch { return null; }
  }
  // For review events, look up the task
  if (
    event.eventType === OrchestrationEventType.REVIEW_REQUESTED ||
    event.eventType === OrchestrationEventType.REVIEW_STARTED ||
    event.eventType === OrchestrationEventType.REVIEW_DECIDED ||
    event.eventType === OrchestrationEventType.REVIEW_APPROVED ||
    event.eventType === OrchestrationEventType.REVIEW_BLOCKED
  ) {
    try {
      const review = repo.getReviewRequest(event.entityId);
      return review.taskId;
    } catch { return null; }
  }
  return null;
}

function resolveReviewRequestId(event: SyncPointEventData): string | null {
  if (
    event.eventType === OrchestrationEventType.REVIEW_REQUESTED ||
    event.eventType === OrchestrationEventType.REVIEW_STARTED ||
    event.eventType === OrchestrationEventType.REVIEW_DECIDED ||
    event.eventType === OrchestrationEventType.REVIEW_APPROVED ||
    event.eventType === OrchestrationEventType.REVIEW_BLOCKED
  ) {
    return event.entityId;
  }
  return null;
}

function mapActionToPrompt(action: string): string {
  const map: Record<string, string> = {
    "plan-tasks": "syncpoint_architect_plan",
    "accept-assignment": "syncpoint_executor_resume",
    "start-work": "syncpoint_executor_resume",
    "checkpoint": "syncpoint_executor_resume",
    "complete-assignment": "syncpoint_executor_resume",
    "address-changes": "syncpoint_executor_resume",
    "start-review": "syncpoint_review_with_evidence",
    "add-checklist": "syncpoint_review_with_evidence",
    "add-evidence": "syncpoint_review_with_evidence",
    "evaluate-gate": "syncpoint_review_with_evidence",
    "approve-review": "syncpoint_review_with_evidence",
    "block-review": "syncpoint_review_with_evidence",
    "request-review": "syncpoint_architect_plan",
    "advance-session": "syncpoint_session_playbook",
  };
  return map[action] ?? "";
}

function mapActionToMcpTool(action: string): string {
  const map: Record<string, string> = {
    "plan-tasks": "syncpoint_session_plan_task",
    "accept-assignment": "syncpoint_session_accept",
    "start-work": "syncpoint_session_start",
    "complete-assignment": "syncpoint_session_complete",
    "request-review": "syncpoint_session_request_review",
    "start-review": "syncpoint_session_start_review",
    "add-checklist": "syncpoint_review_checklist_add",
    "add-evidence": "syncpoint_review_evidence_add",
    "evaluate-gate": "syncpoint_review_gate",
    "approve-review": "syncpoint_review_approve",
    "block-review": "syncpoint_review_block",
    "address-changes": "syncpoint_review_changes_address",
    "advance-session": "syncpoint_session_advance",
    "checkpoint": "syncpoint_loop_checkpoint",
  };
  return map[action] ?? "";
}

function mapActionToCli(action: string): string {
  const map: Record<string, string> = {
    "plan-tasks": "syncpoint session plan --session <id> --task <id> --assignee <agentId>",
    "accept-assignment": "syncpoint session accept --assignment <id>",
    "start-work": "syncpoint session start --assignment <id>",
    "complete-assignment": "syncpoint session complete --assignment <id>",
    "request-review": "syncpoint session review --session <id> --task <id> --reviewer <agentId>",
    "start-review": "syncpoint session start-review --review <id>",
    "add-checklist": "syncpoint review checklist-add --review <id> --title '...'",
    "add-evidence": "syncpoint review evidence-add --review <id> --kind test --title '...' --content '...'",
    "evaluate-gate": "syncpoint review gate --review <id>",
    "approve-review": "syncpoint review approve --review <id> --summary '...'",
    "block-review": "syncpoint review block --review <id> --summary '...'",
    "address-changes": "syncpoint review changes-address --change <id>",
    "advance-session": "syncpoint session advance --session <id>",
    "checkpoint": "syncpoint loop checkpoint --agent <id> --task <id> --summary '...'",
  };
  return map[action] ?? "";
}
