/**
 * Orchestration repository — session, role, assignment, review CRUD.
 */

import { eq, and } from "drizzle-orm";
import * as s from "../schema.js";
import {
  SessionStatus,
  TaskAssignmentStatus,
  ReviewRequestStatus,
  validateSessionTransition,
  validateTaskAssignmentTransition,
  validateReviewRequestTransition,
} from "syncpoint-adapters";
import { ResourceNotFoundError } from "syncpoint-kernel";
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
} from "syncpoint-adapters";
import { _getDb, createId, now } from "./_shared.js";

// ── Session ──────────────────────────────────────────

export function createSession(input: OrchestrationSessionCreate): OrchestrationSession {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.orchestrationSessions).values({
    id,
    title: input.title,
    description: input.description ?? "",
    status: SessionStatus.PLANNING,
    relationshipMode: input.relationshipMode ?? "manager-delegate",
    architectId: input.architectId ?? null,
    createdBy: input.createdBy ?? "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return db.select().from(s.orchestrationSessions).where(eq(s.orchestrationSessions.id, id)).get() as unknown as OrchestrationSession;
}

export function getSession(id: string): OrchestrationSession {
  const db = _getDb();
  const row = db.select().from(s.orchestrationSessions).where(eq(s.orchestrationSessions.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as OrchestrationSession;
}

export function listSessions(): OrchestrationSession[] {
  const db = _getDb();
  return db.select().from(s.orchestrationSessions).all() as unknown as OrchestrationSession[];
}

export function updateSessionStatus(id: string, status: SessionStatus): OrchestrationSession {
  const session = getSession(id);
  validateSessionTransition(session.status as SessionStatus, status);
  const db = _getDb();
  db.update(s.orchestrationSessions)
    .set({ status, updatedAt: now() })
    .where(eq(s.orchestrationSessions.id, id))
    .run();
  return getSession(id);
}

// ── Role Profile ─────────────────────────────────────

export function assignRole(input: RoleProfileCreate): RoleProfile {
  const db = _getDb();
  const id = createId();
  db.insert(s.roleProfiles).values({
    id,
    sessionId: input.sessionId,
    agentId: input.agentId,
    role: input.role,
    capabilities: input.capabilities ?? "",
    assignedAt: now(),
  }).run();
  return db.select().from(s.roleProfiles).where(eq(s.roleProfiles.id, id)).get() as unknown as RoleProfile;
}

export function listRoles(sessionId: string): RoleProfile[] {
  const db = _getDb();
  return db.select().from(s.roleProfiles)
    .where(eq(s.roleProfiles.sessionId, sessionId))
    .all() as unknown as RoleProfile[];
}

export function getRoleForAgent(sessionId: string, agentId: string): RoleProfile | undefined {
  const db = _getDb();
  return db.select().from(s.roleProfiles)
    .where(and(eq(s.roleProfiles.sessionId, sessionId), eq(s.roleProfiles.agentId, agentId)))
    .get() as unknown as RoleProfile | undefined;
}

// ── Task Assignment ──────────────────────────────────

export function createTaskAssignment(input: TaskAssignmentCreate): TaskAssignment {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.taskAssignments).values({
    id,
    sessionId: input.sessionId,
    taskId: input.taskId,
    assigneeAgentId: input.assigneeAgentId,
    assignedBy: input.assignedBy ?? "",
    status: TaskAssignmentStatus.PROPOSED,
    notes: input.notes ?? "",
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return db.select().from(s.taskAssignments).where(eq(s.taskAssignments.id, id)).get() as unknown as TaskAssignment;
}

export function getTaskAssignment(id: string): TaskAssignment {
  const db = _getDb();
  const row = db.select().from(s.taskAssignments).where(eq(s.taskAssignments.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as TaskAssignment;
}

export function listTaskAssignments(sessionId: string): TaskAssignment[] {
  const db = _getDb();
  return db.select().from(s.taskAssignments)
    .where(eq(s.taskAssignments.sessionId, sessionId))
    .all() as unknown as TaskAssignment[];
}

export function updateTaskAssignmentStatus(id: string, status: TaskAssignmentStatus): TaskAssignment {
  const ta = getTaskAssignment(id);
  validateTaskAssignmentTransition(ta.status as TaskAssignmentStatus, status);
  const db = _getDb();
  db.update(s.taskAssignments)
    .set({ status, updatedAt: now() })
    .where(eq(s.taskAssignments.id, id))
    .run();
  return getTaskAssignment(id);
}

// ── Review Request ───────────────────────────────────

export function createReviewRequest(input: ReviewRequestCreate): ReviewRequest {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.reviewRequests).values({
    id,
    sessionId: input.sessionId,
    taskId: input.taskId,
    reviewerAgentId: input.reviewerAgentId,
    requestedBy: input.requestedBy ?? "",
    scope: input.scope ?? "",
    status: ReviewRequestStatus.PENDING,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  return db.select().from(s.reviewRequests).where(eq(s.reviewRequests.id, id)).get() as unknown as ReviewRequest;
}

export function getReviewRequest(id: string): ReviewRequest {
  const db = _getDb();
  const row = db.select().from(s.reviewRequests).where(eq(s.reviewRequests.id, id)).get();
  if (!row) throw new ResourceNotFoundError(id);
  return row as unknown as ReviewRequest;
}

export function listReviewRequests(sessionId: string): ReviewRequest[] {
  const db = _getDb();
  return db.select().from(s.reviewRequests)
    .where(eq(s.reviewRequests.sessionId, sessionId))
    .all() as unknown as ReviewRequest[];
}

export function updateReviewRequestStatus(id: string, status: ReviewRequestStatus): ReviewRequest {
  const rr = getReviewRequest(id);
  validateReviewRequestTransition(rr.status as ReviewRequestStatus, status);
  const db = _getDb();
  db.update(s.reviewRequests)
    .set({ status, updatedAt: now() })
    .where(eq(s.reviewRequests.id, id))
    .run();
  return getReviewRequest(id);
}

// ── Review Decision ──────────────────────────────────

export function createReviewDecision(input: ReviewDecisionCreate): ReviewDecision {
  const db = _getDb();
  const id = createId();
  db.insert(s.reviewDecisions).values({
    id,
    reviewRequestId: input.reviewRequestId,
    verdict: input.verdict,
    summary: input.summary,
    requestedChanges: input.requestedChanges ?? "",
    decidedBy: input.decidedBy ?? "",
    createdAt: now(),
  }).run();
  return db.select().from(s.reviewDecisions).where(eq(s.reviewDecisions.id, id)).get() as unknown as ReviewDecision;
}

export function getReviewDecision(reviewRequestId: string): ReviewDecision | undefined {
  const db = _getDb();
  return db.select().from(s.reviewDecisions)
    .where(eq(s.reviewDecisions.reviewRequestId, reviewRequestId))
    .get() as unknown as ReviewDecision | undefined;
}

export function listReviewDecisions(sessionId: string): ReviewDecision[] {
  const db = _getDb();
  const requests = listReviewRequests(sessionId);
  const decisions: ReviewDecision[] = [];
  for (const rr of requests) {
    const d = getReviewDecision(rr.id);
    if (d) decisions.push(d);
  }
  return decisions;
}
