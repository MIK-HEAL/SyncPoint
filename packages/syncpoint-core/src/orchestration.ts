/**
 * Orchestration types — role profiles, sessions, task assignments, reviews.
 * This is the protocol layer for v0.7 Role Orchestration.
 * It does NOT define context rules (that's context-policy.ts).
 */

import { z } from "zod";

// ── Enums ────────────────────────────────────────────

export const OrchestratorRole = z.enum([
  "architect",
  "executor",
  "reviewer",
  "owner",
]);
export type OrchestratorRole = z.infer<typeof OrchestratorRole>;

export enum SessionStatus {
  PLANNING = "PLANNING",
  EXECUTING = "EXECUTING",
  REVIEWING = "REVIEWING",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export const ReviewVerdict = z.enum([
  "approved",
  "request-changes",
  "rejected",
]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export enum TaskAssignmentStatus {
  PROPOSED = "PROPOSED",
  ACCEPTED = "ACCEPTED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export enum ReviewRequestStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  DECIDED = "DECIDED",
  CANCELLED = "CANCELLED",
}

// ── Schemas ──────────────────────────────────────────

const nanoid12 = z.string().min(1).max(24);
const isoDate = z.string().datetime({ offset: true });

// ── RoleProfile ──────────────────────────────────────

export const RoleProfileSchema = z.object({
  id: nanoid12,
  sessionId: nanoid12,
  agentId: nanoid12,
  role: OrchestratorRole,
  capabilities: z.string().default(""),
  assignedAt: isoDate,
});
export type RoleProfile = z.infer<typeof RoleProfileSchema>;

export const RoleProfileCreateSchema = z.object({
  sessionId: nanoid12,
  agentId: nanoid12,
  role: OrchestratorRole,
  capabilities: z.string().default(""),
});
export type RoleProfileCreate = z.infer<typeof RoleProfileCreateSchema>;

// ── OrchestrationSession ─────────────────────────────

export const OrchestrationSessionSchema = z.object({
  id: nanoid12,
  title: z.string().min(1),
  description: z.string().default(""),
  status: z.nativeEnum(SessionStatus).default(SessionStatus.PLANNING),
  architectId: nanoid12.nullable().default(null),
  createdBy: z.string().default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type OrchestrationSession = z.infer<typeof OrchestrationSessionSchema>;

export const OrchestrationSessionCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  architectId: nanoid12.nullable().default(null),
  createdBy: z.string().default(""),
});
export type OrchestrationSessionCreate = z.infer<typeof OrchestrationSessionCreateSchema>;

// ── TaskAssignment ───────────────────────────────────

export const TaskAssignmentSchema = z.object({
  id: nanoid12,
  sessionId: nanoid12,
  taskId: nanoid12,
  assigneeAgentId: nanoid12,
  assignedBy: z.string().default(""),
  status: z.nativeEnum(TaskAssignmentStatus).default(TaskAssignmentStatus.PROPOSED),
  notes: z.string().default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;

export const TaskAssignmentCreateSchema = z.object({
  sessionId: nanoid12,
  taskId: nanoid12,
  assigneeAgentId: nanoid12,
  assignedBy: z.string().default(""),
  notes: z.string().default(""),
});
export type TaskAssignmentCreate = z.infer<typeof TaskAssignmentCreateSchema>;

// ── ReviewRequest ────────────────────────────────────

export const ReviewRequestSchema = z.object({
  id: nanoid12,
  sessionId: nanoid12,
  taskId: nanoid12,
  reviewerAgentId: nanoid12,
  requestedBy: z.string().default(""),
  scope: z.string().default(""),
  status: z.nativeEnum(ReviewRequestStatus).default(ReviewRequestStatus.PENDING),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const ReviewRequestCreateSchema = z.object({
  sessionId: nanoid12,
  taskId: nanoid12,
  reviewerAgentId: nanoid12,
  requestedBy: z.string().default(""),
  scope: z.string().default(""),
});
export type ReviewRequestCreate = z.infer<typeof ReviewRequestCreateSchema>;

// ── ReviewDecision ───────────────────────────────────

export const ReviewDecisionSchema = z.object({
  id: nanoid12,
  reviewRequestId: nanoid12,
  verdict: ReviewVerdict,
  summary: z.string().min(1),
  requestedChanges: z.string().default(""),
  decidedBy: z.string().default(""),
  createdAt: isoDate,
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const ReviewDecisionCreateSchema = z.object({
  reviewRequestId: nanoid12,
  verdict: ReviewVerdict,
  summary: z.string().min(1),
  requestedChanges: z.string().default(""),
  decidedBy: z.string().default(""),
});
export type ReviewDecisionCreate = z.infer<typeof ReviewDecisionCreateSchema>;

// ── State Transitions ────────────────────────────────

export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  [SessionStatus.PLANNING]: [SessionStatus.EXECUTING, SessionStatus.CANCELLED],
  [SessionStatus.EXECUTING]: [SessionStatus.REVIEWING, SessionStatus.PLANNING, SessionStatus.CANCELLED],
  [SessionStatus.REVIEWING]: [SessionStatus.EXECUTING, SessionStatus.COMPLETED, SessionStatus.CANCELLED],
  [SessionStatus.COMPLETED]: [],
  [SessionStatus.CANCELLED]: [],
};

export const TASK_ASSIGNMENT_TRANSITIONS: Record<TaskAssignmentStatus, TaskAssignmentStatus[]> = {
  [TaskAssignmentStatus.PROPOSED]: [TaskAssignmentStatus.ACCEPTED, TaskAssignmentStatus.CANCELLED],
  [TaskAssignmentStatus.ACCEPTED]: [TaskAssignmentStatus.IN_PROGRESS, TaskAssignmentStatus.CANCELLED],
  [TaskAssignmentStatus.IN_PROGRESS]: [TaskAssignmentStatus.COMPLETED, TaskAssignmentStatus.CANCELLED],
  [TaskAssignmentStatus.COMPLETED]: [],
  [TaskAssignmentStatus.CANCELLED]: [],
};

export const REVIEW_REQUEST_TRANSITIONS: Record<ReviewRequestStatus, ReviewRequestStatus[]> = {
  [ReviewRequestStatus.PENDING]: [ReviewRequestStatus.IN_PROGRESS, ReviewRequestStatus.CANCELLED],
  [ReviewRequestStatus.IN_PROGRESS]: [ReviewRequestStatus.DECIDED, ReviewRequestStatus.CANCELLED],
  [ReviewRequestStatus.DECIDED]: [],
  [ReviewRequestStatus.CANCELLED]: [],
};

// ── Validation ───────────────────────────────────────

import { InvalidTransition } from "./states.js";

export function validateSessionTransition(current: SessionStatus, target: SessionStatus): void {
  const allowed = SESSION_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new InvalidTransition("session", current, target);
  }
}

export function validateTaskAssignmentTransition(current: TaskAssignmentStatus, target: TaskAssignmentStatus): void {
  const allowed = TASK_ASSIGNMENT_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new InvalidTransition("task_assignment", current, target);
  }
}

export function validateReviewRequestTransition(current: ReviewRequestStatus, target: ReviewRequestStatus): void {
  const allowed = REVIEW_REQUEST_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new InvalidTransition("review_request", current, target);
  }
}
