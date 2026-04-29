/**
 * Wake Engine — types, schemas, and pure computation for auto-wake orchestration.
 *
 * A WakeRequest is a first-class concept representing:
 *   "This agent should be woken, with this context, to perform this action."
 *
 * The WakeEngine listens to state-change events, re-computes next actions
 * for all session participants, and generates WakeRequests.
 */

import { z } from "zod";
import type { PlaybookActionKind } from "./playbook-engine.js";
import { RelationshipMode, isValidWakeVerb, MODE_WAKE_VERBS, isModeActionAllowed } from "./relationship-mode.js";

// ── WakeRequest Status ─────────────────────────────────

export enum WakeRequestStatus {
  QUEUED = "QUEUED",
  DISPATCHED = "DISPATCHED",
  RUNNING = "RUNNING",
  DONE = "DONE",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

export const WAKE_REQUEST_TRANSITIONS: Record<WakeRequestStatus, WakeRequestStatus[]> = {
  [WakeRequestStatus.QUEUED]: [WakeRequestStatus.DISPATCHED, WakeRequestStatus.SKIPPED],
  [WakeRequestStatus.DISPATCHED]: [WakeRequestStatus.RUNNING, WakeRequestStatus.FAILED, WakeRequestStatus.SKIPPED],
  [WakeRequestStatus.RUNNING]: [WakeRequestStatus.DONE, WakeRequestStatus.FAILED],
  [WakeRequestStatus.DONE]: [],
  [WakeRequestStatus.FAILED]: [WakeRequestStatus.QUEUED],
  [WakeRequestStatus.SKIPPED]: [],
};

// ── Runner Mode ────────────────────────────────────────

export const WakeRunnerMode = z.enum([
  "manual",    // Generate prompt/command for human to execute
  "mcp",       // Push via MCP resource for editor agent to pick up
  // Future: "codex-cli", "claude-code", "cursor-agent"
]);
export type WakeRunnerMode = z.infer<typeof WakeRunnerMode>;

// ── WakeRequest Schema ─────────────────────────────────

const nanoid12 = z.string().min(1).max(24);
const isoDate = z.string().datetime({ offset: true });

export const WakeRequestSchema = z.object({
  id: nanoid12,
  sessionId: nanoid12,
  targetAgentId: nanoid12,
  targetRole: z.string(),
  action: z.string(),           // PlaybookActionKind value
  reason: z.string(),
  triggerEventType: z.string(), // What event caused this wake
  triggerEntityId: z.string(),  // Entity ID that triggered it
  taskId: nanoid12.nullable().default(null),
  reviewRequestId: nanoid12.nullable().default(null),
  promptHint: z.string().default(""),     // Suggested MCP prompt name
  mcpToolHint: z.string().default(""),    // Suggested MCP tool
  cliHint: z.string().default(""),        // Suggested CLI command
  runnerMode: WakeRunnerMode.default("manual"),
  status: z.nativeEnum(WakeRequestStatus).default(WakeRequestStatus.QUEUED),
  resultSummary: z.string().default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type WakeRequest = z.infer<typeof WakeRequestSchema>;

export const WakeRequestCreateSchema = z.object({
  sessionId: nanoid12,
  targetAgentId: nanoid12,
  targetRole: z.string(),
  action: z.string(),
  reason: z.string(),
  triggerEventType: z.string(),
  triggerEntityId: z.string(),
  taskId: nanoid12.nullable().default(null),
  reviewRequestId: nanoid12.nullable().default(null),
  promptHint: z.string().default(""),
  mcpToolHint: z.string().default(""),
  cliHint: z.string().default(""),
  runnerMode: WakeRunnerMode.default("manual"),
});
export type WakeRequestCreate = z.infer<typeof WakeRequestCreateSchema>;

// ── Orchestration Event Types for Wake ─────────────────

export enum OrchestrationEventType {
  SESSION_CREATED = "SESSION_CREATED",
  SESSION_ADVANCED = "SESSION_ADVANCED",
  SESSION_CANCELLED = "SESSION_CANCELLED",
  ROLE_ASSIGNED = "ROLE_ASSIGNED",
  ASSIGNMENT_CREATED = "ASSIGNMENT_CREATED",
  ASSIGNMENT_ACCEPTED = "ASSIGNMENT_ACCEPTED",
  ASSIGNMENT_STARTED = "ASSIGNMENT_STARTED",
  ASSIGNMENT_COMPLETED = "ASSIGNMENT_COMPLETED",
  REVIEW_REQUESTED = "REVIEW_REQUESTED",
  REVIEW_STARTED = "REVIEW_STARTED",
  REVIEW_DECIDED = "REVIEW_DECIDED",
  REVIEW_APPROVED = "REVIEW_APPROVED",
  REVIEW_BLOCKED = "REVIEW_BLOCKED",
}

// ── Default Orchestration Graph ────────────────────────

/**
 * A graph node defines: when this condition is met, wake the target role.
 * This is the built-in default graph:
 *
 *   Architect Plan → Executor Work → Reviewer Review → Architect Final → Done
 */
export interface WakeRule {
  /** Event type that triggers this rule */
  trigger: string;
  /** Role to wake */
  targetRole: string;
  /** Action the target should perform */
  action: PlaybookActionKind;
  /** Human-readable reason */
  reason: string;
  /** Priority (1 = immediate) */
  priority: number;
  /** Optional: only fire if session is in this status */
  sessionStatus?: string;
}

export const DEFAULT_WAKE_RULES: WakeRule[] = [
  // Session created → wake architect to plan
  {
    trigger: OrchestrationEventType.SESSION_CREATED,
    targetRole: "architect",
    action: "plan-tasks",
    reason: "Session created. Plan tasks and assign agents.",
    priority: 1,
  },
  // Session advanced to EXECUTING → wake executors to accept assignments
  {
    trigger: OrchestrationEventType.SESSION_ADVANCED,
    targetRole: "executor",
    action: "accept-assignment",
    reason: "Session advanced to executing. Accept your assignment.",
    priority: 1,
    sessionStatus: "EXECUTING",
  },
  // Assignment created (task planned) → wake executor to accept
  {
    trigger: OrchestrationEventType.ASSIGNMENT_CREATED,
    targetRole: "executor",
    action: "accept-assignment",
    reason: "New task assignment. Accept and begin work.",
    priority: 1,
  },
  // Assignment completed → wake architect to request review
  {
    trigger: OrchestrationEventType.ASSIGNMENT_COMPLETED,
    targetRole: "architect",
    action: "request-review",
    reason: "Executor completed assignment. Request a review.",
    priority: 1,
  },
  // Review requested → wake reviewer to start review
  {
    trigger: OrchestrationEventType.REVIEW_REQUESTED,
    targetRole: "reviewer",
    action: "start-review",
    reason: "Review requested. Start reviewing the task.",
    priority: 1,
  },
  // Review approved → wake architect to advance session (final acceptance)
  {
    trigger: OrchestrationEventType.REVIEW_APPROVED,
    targetRole: "architect",
    action: "advance-session",
    reason: "Review approved. Advance session to completion.",
    priority: 1,
  },
  // Review blocked (changes requested) → wake executor to address changes
  {
    trigger: OrchestrationEventType.REVIEW_BLOCKED,
    targetRole: "executor",
    action: "address-changes",
    reason: "Review blocked with change requests. Address and resubmit.",
    priority: 1,
  },
];

// ── Pure Computation: Event → Wake Targets ─────────────

export interface WakeTarget {
  targetRole: string;
  action: PlaybookActionKind;
  reason: string;
  priority: number;
}

/**
 * Every valid wake action must have synchronization semantics:
 * it requires confirmation, handoff, review, or conflict resolution.
 * This whitelist prevents "infinite auto-work" wakes.
 */
export const SYNC_VERB_WHITELIST: readonly string[] = [
  "plan", "accept", "checkpoint", "sync", "review",
  "handoff", "resume", "approve",
  // Mapped playbook actions
  "plan-tasks", "accept-assignment", "start-review",
  "request-review", "advance-session", "address-changes",
  "claim-files", "sync-checkpoint",
] as const;

export interface WakeContext {
  triggerEventType: string;
  sessionId: string;
  sessionStatus: string;
  /** All roles in the session, for resolving who to wake */
  roleBindings: Array<{ agentId: string; role: string }>;
  /** Relationship mode — if set, wake actions are filtered by mode's allowed verbs */
  relationshipMode?: RelationshipMode;
}

/**
 * Pure function: given a trigger event and session context,
 * compute which roles should be woken.
 * Uses the default wake rules (can be extended with custom rules later).
 */
export function computeWakeTargets(
  ctx: WakeContext,
  rules: WakeRule[] = DEFAULT_WAKE_RULES,
): WakeTarget[] {
  const targets: WakeTarget[] = [];

  for (const rule of rules) {
    if (rule.trigger !== ctx.triggerEventType) continue;

    // Optional session status filter
    if (rule.sessionStatus && rule.sessionStatus !== ctx.sessionStatus) continue;

    // Check if the target role exists in the session
    const hasRole = ctx.roleBindings.some(rb => rb.role === rule.targetRole);
    if (!hasRole) continue;

    // P4: Sync verb enforcement — only allow sync-semantic actions
    if (!SYNC_VERB_WHITELIST.includes(rule.action)) continue;

    // P4: Mode-aware verb filtering — if mode is set, filter by mode's allowed verbs
    if (ctx.relationshipMode && !isValidWakeVerb(ctx.relationshipMode, rule.action)) continue;

    // P3: Unified mode enforcement — block actions that FORBIDDEN_ACTIONS disallows
    if (ctx.relationshipMode && isModeActionAllowed(ctx.relationshipMode, rule.action) === "blocked") continue;

    targets.push({
      targetRole: rule.targetRole,
      action: rule.action,
      reason: rule.reason,
      priority: rule.priority,
    });
  }

  return targets.sort((a, b) => a.priority - b.priority);
}

// ── Validate WakeRequest Transition ────────────────────

export function validateWakeRequestTransition(current: WakeRequestStatus, target: WakeRequestStatus): void {
  const allowed = WAKE_REQUEST_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new Error(`Invalid WakeRequest transition: ${current} → ${target}`);
  }
}
