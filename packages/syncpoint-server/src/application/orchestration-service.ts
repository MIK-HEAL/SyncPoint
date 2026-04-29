/**
 * Orchestration Service — role orchestration use cases.
 * CLI, MCP, and tRPC all share this layer.
 */

import {
  SessionStatus,
  TaskAssignmentStatus,
  ReviewRequestStatus,
  TaskStatus,
  EventType,
} from "syncpoint-core";
import type {
  OrchestrationSession,
  OrchestrationSessionCreate,
  RoleProfile,
  RoleProfileCreate,
  TaskAssignment,
  TaskAssignmentCreate,
  ReviewRequest,
  ReviewRequestCreate,
  ReviewDecision,
  ReviewDecisionCreate,
  OrchestratorRole,
  ReviewVerdict,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { processOrchestrationEvent } from "./wake-engine-service.js";
import { prepareContext } from "./context-policy-service.js";
import { sgCheckAgent } from "./sync-gate-service.js";
import { RelationshipMode } from "syncpoint-core";
import type { PreparedContext } from "syncpoint-core";

/**
 * Log an orchestration event AND trigger wake generation inline.
 * This ensures wake requests are created regardless of entry point
 * (HTTP server, MCP stdio, CLI, tests).
 */
function orchEvent(eventType: EventType, entityType: string, entityId: string, detail = ""): void {
  logEvent(eventType, entityType, entityId, detail);
  try {
    processOrchestrationEvent(eventType, entityType, entityId, detail);
  } catch (err) {
    // Never let wake engine errors break the orchestration action
    console.error("[orchEvent] Wake processing error:", err);
  }
}

// ── Input/Output Types ───────────────────────────────

export interface CreateSessionInput {
  title: string;
  description?: string;
  relationshipMode?: string;
  architectId?: string;
  createdBy?: string;
}

export interface CreateSessionResult {
  ok: true;
  session: OrchestrationSession;
  architectRole?: RoleProfile;
}

export interface AssignRoleInput {
  sessionId: string;
  agentId: string;
  role: OrchestratorRole;
  capabilities?: string;
}

export interface PlanTaskInput {
  sessionId: string;
  taskId: string;
  assigneeAgentId: string;
  assignedBy?: string;
  notes?: string;
}

export interface RequestReviewInput {
  sessionId: string;
  taskId: string;
  reviewerAgentId: string;
  requestedBy?: string;
  scope?: string;
}

export interface SubmitReviewInput {
  reviewRequestId: string;
  verdict: ReviewVerdict;
  summary: string;
  requestedChanges?: string;
  decidedBy?: string;
}

export interface SessionStatusResult {
  session: OrchestrationSession;
  roles: RoleProfile[];
  assignments: TaskAssignment[];
  reviews: ReviewRequest[];
  decisions: ReviewDecision[];
}

export interface AdvanceSessionResult {
  session: OrchestrationSession;
  transitioned: boolean;
  reason: string;
}

// ── Use Cases ────────────────────────────────────────

/**
 * Create a new orchestration session. Optionally assign architect role.
 */
export function orchCreateSession(input: CreateSessionInput): CreateSessionResult {
  if (input.architectId) {
    repo.getAgent(input.architectId);
  }

  const session = repo.createSession({
    title: input.title,
    description: input.description ?? "",
    relationshipMode: (input.relationshipMode as any) ?? undefined,
    architectId: input.architectId ?? null,
    createdBy: input.createdBy ?? "",
  });

  let architectRole: RoleProfile | undefined;
  if (input.architectId) {
    architectRole = repo.assignRole({
      sessionId: session.id,
      agentId: input.architectId,
      role: "architect",
      capabilities: "",
    });
  }

  orchEvent(EventType.SESSION_CREATED, "session", session.id);
  return { ok: true, session, architectRole };
}

/**
 * Assign a role to an agent within a session.
 */
export function orchAssignRole(input: AssignRoleInput): RoleProfile {
  repo.getSession(input.sessionId);
  repo.getAgent(input.agentId);

  const role = repo.assignRole({
    sessionId: input.sessionId,
    agentId: input.agentId,
    role: input.role,
    capabilities: input.capabilities ?? "",
  });
  orchEvent(EventType.ROLE_ASSIGNED, "role_profile", role.id, input.sessionId);
  return role;
}

/**
 * Plan a task: create assignment within a session.
 * Also assigns the task to the agent via existing repo.
 */
export function orchPlanTask(input: PlanTaskInput): TaskAssignment {
  repo.getSession(input.sessionId);
  repo.getAgent(input.assigneeAgentId);

  // Ensure task is assigned to agent in the core task table
  const task = repo.getTask(input.taskId);
  if (!task.ownerAgentId) {
    repo.assignTask(input.taskId, input.assigneeAgentId);
  } else if (task.ownerAgentId !== input.assigneeAgentId) {
    throw new Error(`Task ${task.id} is already assigned to ${task.ownerAgentId}, not ${input.assigneeAgentId}`);
  }

  const assignment = repo.createTaskAssignment({
    sessionId: input.sessionId,
    taskId: input.taskId,
    assigneeAgentId: input.assigneeAgentId,
    assignedBy: input.assignedBy ?? "",
    notes: input.notes ?? "",
  });
  orchEvent(EventType.ASSIGNMENT_CREATED, "task_assignment", assignment.id);
  return assignment;
}

/**
 * Accept a task assignment — agent confirms they will work on it.
 */
export function orchAcceptAssignment(assignmentId: string): TaskAssignment {
  const ta = repo.updateTaskAssignmentStatus(assignmentId, TaskAssignmentStatus.ACCEPTED);
  orchEvent(EventType.ASSIGNMENT_ACCEPTED, "task_assignment", ta.id);
  return ta;
}

/**
 * Start working on an assigned task.
 */
export function orchStartAssignment(assignmentId: string): TaskAssignment {
  // SyncGate hard gate — block start if agent has unacknowledged gates
  const ta0 = repo.getTaskAssignment(assignmentId);
  const blockCheck = sgCheckAgent(ta0.assigneeAgentId, { taskId: ta0.taskId });
  if (blockCheck.blocked) {
    const gateIds = blockCheck.blockingGates.map(g => g.id).join(", ");
    throw new Error(`Agent blocked by sync gate(s): ${gateIds}. Acknowledge before starting work.`);
  }

  // P7: peer-contract requires file claims before starting work
  const session = repo.getSession(ta0.sessionId);
  if ((session as any).relationshipMode === RelationshipMode.PEER_CONTRACT) {
    const claims = repo.listActiveFileClaims(ta0.sessionId);
    const agentClaims = claims.filter(c => c.agentId === ta0.assigneeAgentId);
    if (agentClaims.length === 0) {
      throw new Error(
        `peer-contract mode requires file claims before starting work. ` +
        `Agent ${ta0.assigneeAgentId} has no active file claims. ` +
        `Use 'syncpoint file claim' first.`
      );
    }
  }

  const ta = repo.updateTaskAssignmentStatus(assignmentId, TaskAssignmentStatus.IN_PROGRESS);
  orchEvent(EventType.ASSIGNMENT_STARTED, "task_assignment", ta.id);
  // Also move task to IN_PROGRESS if it's in a pre-work state
  try {
    const task = repo.getTask(ta.taskId);
    if (task.status === TaskStatus.ASSIGNED || task.status === TaskStatus.READY_TO_WORK) {
      repo.updateTaskStatus(ta.taskId, TaskStatus.IN_PROGRESS);
    }
  } catch { /* ignore if task status transition is invalid */ }
  return ta;
}

/**
 * Complete a task assignment.
 */
export function orchCompleteAssignment(assignmentId: string): TaskAssignment {
  const ta = repo.updateTaskAssignmentStatus(assignmentId, TaskAssignmentStatus.COMPLETED);
  orchEvent(EventType.ASSIGNMENT_COMPLETED, "task_assignment", ta.id);
  return ta;
}

/**
 * Request a review for a task.
 */
export function orchRequestReview(input: RequestReviewInput): ReviewRequest {
  repo.getSession(input.sessionId);
  repo.getTask(input.taskId);
  repo.getAgent(input.reviewerAgentId);

  const assignments = repo.listTaskAssignments(input.sessionId);
  const inSession = assignments.some(a => a.taskId === input.taskId);
  if (!inSession) {
    throw new Error(`Task ${input.taskId} is not assigned in session ${input.sessionId}`);
  }

  // Move task to REVIEWING status if it's IN_PROGRESS
  try {
    const task = repo.getTask(input.taskId);
    if (task.status === TaskStatus.IN_PROGRESS) {
      repo.updateTaskStatus(input.taskId, TaskStatus.REVIEWING);
    }
  } catch { /* ignore */ }

  const rr = repo.createReviewRequest({
    sessionId: input.sessionId,
    taskId: input.taskId,
    reviewerAgentId: input.reviewerAgentId,
    requestedBy: input.requestedBy ?? "",
    scope: input.scope ?? "",
  });
  orchEvent(EventType.REVIEW_REQUESTED, "review_request", rr.id);
  return rr;
}

/**
 * Start a review (reviewer picks up the request).
 */
export function orchStartReview(reviewRequestId: string): ReviewRequest {
  const rr = repo.updateReviewRequestStatus(reviewRequestId, ReviewRequestStatus.IN_PROGRESS);
  orchEvent(EventType.REVIEW_STARTED, "review_request", rr.id);
  return rr;
}

/**
 * Submit a review decision.
 */
export function orchSubmitReview(input: SubmitReviewInput): {
  decision: ReviewDecision;
  reviewRequest: ReviewRequest;
} {
  // Mark review request as decided
  const rr = repo.updateReviewRequestStatus(input.reviewRequestId, ReviewRequestStatus.DECIDED);

  const decision = repo.createReviewDecision({
    reviewRequestId: input.reviewRequestId,
    verdict: input.verdict,
    summary: input.summary,
    requestedChanges: input.requestedChanges ?? "",
    decidedBy: input.decidedBy ?? "",
  });

  // Side effects based on verdict
  try {
    if (input.verdict === "approved") {
      // Move task to DONE
      repo.updateTaskStatus(rr.taskId, TaskStatus.DONE);
    } else if (input.verdict === "request-changes") {
      // Move task back to IN_PROGRESS
      repo.updateTaskStatus(rr.taskId, TaskStatus.IN_PROGRESS);
    }
  } catch { /* ignore invalid transitions */ }

  orchEvent(EventType.REVIEW_DECIDED, "review_request", rr.id, input.verdict);
  if (input.verdict === "approved") {
    orchEvent(EventType.REVIEW_APPROVED, "review_request", rr.id);
  } else if (input.verdict === "request-changes" || input.verdict === "rejected") {
    orchEvent(EventType.REVIEW_BLOCKED, "review_request", rr.id);
  }
  return { decision, reviewRequest: rr };
}

/**
 * Get full session status with all roles, assignments, reviews, decisions.
 */
export function orchGetSessionStatus(sessionId: string): SessionStatusResult {
  const session = repo.getSession(sessionId);
  const roles = repo.listRoles(sessionId);
  const assignments = repo.listTaskAssignments(sessionId);
  const reviews = repo.listReviewRequests(sessionId);
  const decisions = repo.listReviewDecisions(sessionId);

  return { session, roles, assignments, reviews, decisions };
}

/**
 * Advance session status based on current state of assignments and reviews.
 */
export function orchAdvanceSession(sessionId: string): AdvanceSessionResult {
  const session = repo.getSession(sessionId);
  const assignments = repo.listTaskAssignments(sessionId);
  const reviews = repo.listReviewRequests(sessionId);

  const currentStatus = session.status as SessionStatus;

  // PLANNING → EXECUTING: when there's at least one assignment
  if (currentStatus === SessionStatus.PLANNING && assignments.length > 0) {
    const updated = repo.updateSessionStatus(sessionId, SessionStatus.EXECUTING);
    orchEvent(EventType.SESSION_ADVANCED, "session", sessionId, `PLANNING→EXECUTING`);
    return { session: updated, transitioned: true, reason: "Tasks assigned, moving to execution." };
  }

  // EXECUTING → REVIEWING: when all assignments are completed
  if (currentStatus === SessionStatus.EXECUTING) {
    const allCompleted = assignments.length > 0 &&
      assignments.every(a => a.status === TaskAssignmentStatus.COMPLETED);
    if (allCompleted) {
      const updated = repo.updateSessionStatus(sessionId, SessionStatus.REVIEWING);
      orchEvent(EventType.SESSION_ADVANCED, "session", sessionId, `EXECUTING→REVIEWING`);
      return { session: updated, transitioned: true, reason: "All tasks completed, moving to review." };
    }
  }

  // REVIEWING → COMPLETED: when all reviews are decided and approved
  if (currentStatus === SessionStatus.REVIEWING) {
    const allDecided = reviews.length > 0 &&
      reviews.every(r => r.status === ReviewRequestStatus.DECIDED);
    if (allDecided) {
      const decisions = repo.listReviewDecisions(sessionId);
      const allApproved = decisions.every(d => d.verdict === "approved");
      if (allApproved) {
        const updated = repo.updateSessionStatus(sessionId, SessionStatus.COMPLETED);
        orchEvent(EventType.SESSION_ADVANCED, "session", sessionId, `REVIEWING→COMPLETED`);
        return { session: updated, transitioned: true, reason: "All reviews approved, session completed." };
      }
      // Some rejected — back to executing
      const updated = repo.updateSessionStatus(sessionId, SessionStatus.EXECUTING);
      orchEvent(EventType.SESSION_ADVANCED, "session", sessionId, `REVIEWING→EXECUTING`);
      return { session: updated, transitioned: true, reason: "Some reviews not approved, returning to execution." };
    }
  }

  return { session, transitioned: false, reason: "No transition conditions met." };
}

/**
 * Prepare reviewer context for a task within a session, reusing Context Policy.
 */
export function orchPrepareReviewContext(taskId: string, reviewerAgentId: string): PreparedContext {
  return prepareContext({ intent: "review", role: "reviewer", taskId, agentId: reviewerAgentId });
}

/**
 * Cancel a session.
 */
export function orchCancelSession(sessionId: string): OrchestrationSession {
  const session = repo.updateSessionStatus(sessionId, SessionStatus.CANCELLED);
  orchEvent(EventType.SESSION_CANCELLED, "session", sessionId);
  return session;
}
