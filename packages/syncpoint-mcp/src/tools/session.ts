import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchCompleteAssignment,
  orchRequestReview,
  orchStartReview,
  orchSubmitReview,
  orchGetSessionStatus,
  orchAdvanceSession,
} from "syncpoint-server/application";
import { OrchestratorRole, ReviewVerdict } from "syncpoint-adapters";
import { fail, ok } from "./_shared.js";

export function registerSessionTools(server: McpServer): void {
  // ── syncpoint_session_create ──
  server.registerTool(
    "syncpoint_session_create",
    {
      title: "Create Sync Session",
      description: "Create a synchronization session with optional architect role assignment. relationshipMode defines the claim, checkpoint, review, or handoff boundaries agents must respect.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        architectId: z.string().optional(),
        relationshipMode: z.enum(["manager-delegate", "peer-contract", "handoff-resume"]).optional().describe("Coordination pattern: manager-delegate (default), peer-contract, or handoff-resume"),
      },
    },
    async ({ title, description, architectId, relationshipMode }) => {
      try {
        const result = orchCreateSession({ title, description, architectId, relationshipMode, createdBy: "mcp" });
        return ok(result);
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_status ──
  server.registerTool(
    "syncpoint_session_status",
    {
      title: "Session Status",
      description: "Get full synchronization session status including roles, assignments, reviews, and decisions. Use with Sync View to inspect active blockers.",
      inputSchema: {
        sessionId: z.string(),
      },
    },
    async ({ sessionId }) => {
      try {
        return ok(orchGetSessionStatus(sessionId));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_assign_role ──
  server.registerTool(
    "syncpoint_session_assign_role",
    {
      title: "Assign Role",
      description: "Assign a sync responsibility (architect/executor/reviewer/owner) to an agent within a session",
      inputSchema: {
        sessionId: z.string(),
        agentId: z.string(),
        role: OrchestratorRole,
      },
    },
    async ({ sessionId, agentId, role }) => {
      try {
        return ok(orchAssignRole({ sessionId, agentId, role }));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_plan_task ──
  server.registerTool(
    "syncpoint_session_plan_task",
    {
      title: "Plan Task",
      description: "Plan a task assignment within a sync session. This assigns scope, but continuation is still gated by claims and blockers.",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        assigneeAgentId: z.string(),
        notes: z.string().optional(),
      },
    },
    async ({ sessionId, taskId, assigneeAgentId, notes }) => {
      try {
        return ok(orchPlanTask({ sessionId, taskId, assigneeAgentId, assignedBy: "mcp", notes }));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_accept ──
  server.registerTool(
    "syncpoint_session_accept",
    {
      title: "Accept Assignment",
      description: "Accept a task assignment — agent confirms they will work on it",
      inputSchema: { assignmentId: z.string() },
    },
    async ({ assignmentId }) => {
      try { return ok(orchAcceptAssignment(assignmentId)); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_start ──
  server.registerTool(
    "syncpoint_session_start",
    {
      title: "Start Assignment",
      description: "Start working on an accepted task assignment",
      inputSchema: { assignmentId: z.string() },
    },
    async ({ assignmentId }) => {
      try { return ok(orchStartAssignment(assignmentId)); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_complete ──
  server.registerTool(
    "syncpoint_session_complete",
    {
      title: "Complete Assignment",
      description: "Mark a task assignment as completed",
      inputSchema: { assignmentId: z.string() },
    },
    async ({ assignmentId }) => {
      try { return ok(orchCompleteAssignment(assignmentId)); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_request_review ──
  server.registerTool(
    "syncpoint_session_request_review",
    {
      title: "Request Review",
      description: "Request a review for a completed task within a session",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        reviewerAgentId: z.string(),
        scope: z.string().optional(),
      },
    },
    async ({ sessionId, taskId, reviewerAgentId, scope }) => {
      try {
        return ok(orchRequestReview({ sessionId, taskId, reviewerAgentId, requestedBy: "mcp", scope }));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_start_review ──
  server.registerTool(
    "syncpoint_session_start_review",
    {
      title: "Start Review",
      description: "Start a review — reviewer picks up the review request",
      inputSchema: { reviewRequestId: z.string() },
    },
    async ({ reviewRequestId }) => {
      try { return ok(orchStartReview(reviewRequestId)); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_review_decide ──
  server.registerTool(
    "syncpoint_session_review_decide",
    {
      title: "Submit Review Decision",
      description: "Submit a review verdict: approved, request-changes, or rejected",
      inputSchema: {
        reviewRequestId: z.string(),
        verdict: ReviewVerdict,
        summary: z.string(),
        requestedChanges: z.string().optional(),
      },
    },
    async ({ reviewRequestId, verdict, summary, requestedChanges }) => {
      try {
        return ok(orchSubmitReview({ reviewRequestId, verdict, summary, requestedChanges, decidedBy: "mcp" }));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_advance ──
  server.registerTool(
    "syncpoint_session_advance",
    {
      title: "Advance Session",
      description: "Advance session status based on current assignments and review state",
      inputSchema: {
        sessionId: z.string(),
      },
    },
    async ({ sessionId }) => {
      try {
        return ok(orchAdvanceSession(sessionId));
      } catch (e) { return fail(e); }
    }
  );
}
