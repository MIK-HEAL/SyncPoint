/**
 * Playbook Service — orchestration playbook use cases.
 * Provides next-action computation, evidence capture, and active session lookup.
 * CLI, MCP, and tRPC all share this layer.
 */

import {
  computeNextActions,
  ChangeRequestStatus,
} from "syncpoint-core";
import type {
  NextAction,
  SessionSnapshot,
  EvidenceKind,
  ReviewEvidence,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { rwAddEvidence, rwEvaluateGate, rwListChangeRequests } from "./review-workflow-service.js";
import { orchGetSessionStatus } from "./orchestration-service.js";

// ── Input / Output Types ────────────────────────────

export interface NextActionInput {
  sessionId: string;
  agentId: string;
}

export interface NextActionResult {
  sessionId: string;
  agentId: string;
  sessionStatus: string;
  actions: NextAction[];
}

export interface CaptureEvidenceInput {
  reviewRequestId: string;
  command: string;
  output: string;
  exitCode?: number;
  kind?: EvidenceKind;
  createdBy?: string;
}

export interface CaptureEvidenceResult {
  evidence: ReviewEvidence;
  kind: string;
  title: string;
}

export interface ActiveSessionResult {
  sessionId: string;
  sessionStatus: string;
  agentId: string;
  agentName: string;
  roles: string[];
  assignmentCount: number;
  reviewCount: number;
  actions: NextAction[];
}

// ── Use Cases ────────────────────────────────────────

/**
 * Compute next actions for an agent within a session.
 * Assembles a SessionSnapshot from current DB state and delegates to the pure engine.
 */
export function pbGetNextAction(input: NextActionInput): NextActionResult {
  const status = orchGetSessionStatus(input.sessionId);
  repo.getAgent(input.agentId); // validate agent exists

  const agentRoles = status.roles
    .filter(r => r.agentId === input.agentId)
    .map(r => r.role);

  // Build gates and openChanges for reviews assigned to this agent
  const gates: SessionSnapshot["gates"] = {};
  const openChanges: SessionSnapshot["openChanges"] = {};

  for (const r of status.reviews) {
    if (r.reviewerAgentId === input.agentId) {
      try {
        gates[r.id] = rwEvaluateGate(r.id);
      } catch { /* ignore if gate computation fails */ }
      try {
        const changes = rwListChangeRequests(r.id);
        openChanges[r.id] = changes.filter(c => c.status === ChangeRequestStatus.OPEN).length;
      } catch { /* ignore */ }
    }
    // Also track open changes for reviews on tasks this agent executes
    const myAssignment = status.assignments.find(a => a.taskId === r.taskId && a.assigneeAgentId === input.agentId);
    if (myAssignment) {
      try {
        const changes = rwListChangeRequests(r.id);
        openChanges[r.id] = changes.filter(c => c.status === ChangeRequestStatus.OPEN).length;
      } catch { /* ignore */ }
    }
  }

  const snap: SessionSnapshot = {
    sessionId: input.sessionId,
    sessionStatus: status.session.status as any,
    agentId: input.agentId,
    agentRoles,
    assignments: status.assignments.map(a => ({
      id: a.id,
      taskId: a.taskId,
      assigneeAgentId: a.assigneeAgentId,
      status: a.status as any,
    })),
    reviews: status.reviews.map(r => ({
      id: r.id,
      taskId: r.taskId,
      reviewerAgentId: r.reviewerAgentId,
      status: r.status as any,
    })),
    gates,
    openChanges,
    relationshipMode: (status.session as any).relationshipMode ?? undefined,
  };

  const actions = computeNextActions(snap);

  return {
    sessionId: input.sessionId,
    agentId: input.agentId,
    sessionStatus: status.session.status,
    actions,
  };
}

/**
 * Capture command output as review evidence.
 * Auto-detects evidence kind from command name if not specified.
 */
export function pbCaptureEvidence(input: CaptureEvidenceInput): CaptureEvidenceResult {
  const kind = input.kind ?? detectEvidenceKind(input.command);
  const title = input.command;
  const metadataJson = input.exitCode !== undefined
    ? JSON.stringify({ command: input.command, exitCode: input.exitCode })
    : JSON.stringify({ command: input.command });

  const evidence = rwAddEvidence({
    reviewRequestId: input.reviewRequestId,
    kind,
    title,
    content: input.output,
    metadataJson,
    createdBy: input.createdBy,
  });

  return { evidence, kind, title };
}

/**
 * Find the active session for an agent and return a summary with next actions.
 * Looks for the most recent non-COMPLETED, non-CANCELLED session the agent is part of.
 */
export function pbGetActiveSession(agentId: string): ActiveSessionResult | null {
  const agent = repo.getAgent(agentId);
  const sessions = repo.listSessions();

  // Find sessions this agent has a role in, sorted by most recent
  for (const sess of sessions.reverse()) {
    if (sess.status === "COMPLETED" || sess.status === "CANCELLED") continue;

    const roles = repo.listRoles(sess.id);
    const agentRoles = roles.filter(r => r.agentId === agentId);
    if (agentRoles.length === 0) continue;

    // Found active session
    const result = pbGetNextAction({ sessionId: sess.id, agentId });
    const assignments = repo.listTaskAssignments(sess.id);
    const reviews = repo.listReviewRequests(sess.id);

    return {
      sessionId: sess.id,
      sessionStatus: sess.status,
      agentId,
      agentName: agent.name,
      roles: agentRoles.map(r => r.role),
      assignmentCount: assignments.filter(a => a.assigneeAgentId === agentId).length,
      reviewCount: reviews.filter(r => r.reviewerAgentId === agentId).length,
      actions: result.actions,
    };
  }

  return null;
}

// ── Helpers ──────────────────────────────────────────

function detectEvidenceKind(command: string): EvidenceKind {
  const cmd = command.toLowerCase();
  if (cmd.includes("test") || cmd.includes("vitest") || cmd.includes("jest")) return "test";
  if (cmd.includes("build") || cmd.includes("tsc") || cmd.includes("esbuild")) return "build";
  if (cmd.includes("typecheck") || cmd.includes("tsc --noEmit")) return "typecheck";
  if (cmd.includes("lint") || cmd.includes("eslint") || cmd.includes("biome")) return "lint";
  if (cmd.includes("diff") || cmd.includes("git diff")) return "diff";
  return "manual";
}
