/**
 * MCP tools — state-mutating operations exposed to LLM clients.
 * All tools delegate to application layer use cases.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loopStatus, loopResume, loopCheckpoint, loopHandoff,
  pmAdd, pmApprove, pmSearch, pmExport,
  prepareContext, getContextPolicyInfo,
  orchCreateSession, orchAssignRole, orchPlanTask,
  orchAcceptAssignment, orchStartAssignment, orchCompleteAssignment,
  orchRequestReview, orchStartReview, orchSubmitReview,
  orchGetSessionStatus, orchAdvanceSession,
  rwCreateChecklistItem, rwUpdateChecklistItem, rwListChecklist,
  rwAddEvidence, rwListEvidence,
  rwRequestChanges, rwAddressChange,
  rwEvaluateGate, rwApproveReview, rwBlockReview,
  rwPrepareReviewPacket,
  pbGetNextAction, pbCaptureEvidence, pbGetActiveSession,
  wakeList, wakeGet, wakeNext, wakeAck, wakeStart, wakeDone, wakeFail, wakeSkip, wakeEngineStats,
  fcClaimFiles, fcReleaseClaim, fcListClaims, fcDetectConflicts,
  sgRequest, sgAck, sgResolve, sgCancel, sgStatus, sgList, sgListActive, sgCheckAgent,
  stxCreate, stxApprove, stxReject, stxResolve, stxCancel, stxStatus, stxList,
  ppPropose, ppSubmit, ppCheck, ppApprove, ppReject, ppApply, ppCancel, ppStatus, ppList,
} from "syncpoint-server/application";
import { getResumeContext } from "syncpoint-server/repositories";
import { formatResumePrompt, ProjectMemoryCreateSchema, ContextIntent, ContextRole, OrchestratorRole, ReviewVerdict, EvidenceKind, PlaybookActionKind } from "syncpoint-core";
import type { ChecklistItemStatus } from "syncpoint-core";
import { safeError } from "./errors.js";
import { formatToolResult } from "./format.js";

function ok(data: object) {
  return { content: [{ type: "text" as const, text: formatToolResult(data as Record<string, unknown>) }] };
}

function fail(err: unknown) {
  return { content: [{ type: "text" as const, text: safeError(err) }], isError: true as const };
}

export function registerTools(server: McpServer): void {
  // ── syncpoint_loop_status ──
  server.registerTool(
    "syncpoint_loop_status",
    {
      title: "Loop Status",
      description: "Get current agent and task status",
      inputSchema: { agentId: z.string(), taskId: z.string().optional() },
    },
    async ({ agentId, taskId }) => {
      try { return ok(loopStatus({ agentId, taskId })); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_loop_resume ──
  server.registerTool(
    "syncpoint_loop_resume",
    {
      title: "Loop Resume",
      description: "Resume a task — enforces context policy, generates adapter files and prompt",
      inputSchema: {
        agentId: z.string(),
        taskId: z.string(),
        provider: z.string().optional(),
        format: z.enum(["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"]).optional(),
      },
    },
    async ({ agentId, taskId, provider, format }) => {
      try { return ok(loopResume({ agentId, taskId, provider, format })); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_loop_checkpoint ──
  server.registerTool(
    "syncpoint_loop_checkpoint",
    {
      title: "Loop Checkpoint",
      description: "Save a checkpoint and context capsule for the current work session",
      inputSchema: {
        agentId: z.string(),
        taskId: z.string(),
        summary: z.string(),
        progress: z.string().optional(),
        nextSteps: z.string().optional(),
        risks: z.string().optional(),
        blockers: z.string().optional(),
        goal: z.string().optional(),
        phase: z.string().optional(),
        completed: z.string().optional(),
        remaining: z.string().optional(),
        workingFiles: z.string().optional(),
        resumePrompt: z.string().optional(),
        needSync: z.boolean().optional(),
        provider: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok(loopCheckpoint(input)); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_loop_handoff ──
  server.registerTool(
    "syncpoint_loop_handoff",
    {
      title: "Loop Handoff",
      description: "Hand off a task from one agent to another",
      inputSchema: {
        taskId: z.string(),
        fromAgentId: z.string(),
        toAgentId: z.string(),
        context: z.string(),
        autoAccept: z.boolean().optional(),
        provider: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok(loopHandoff(input)); }
      catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_resume_context_get ──
  server.registerTool(
    "syncpoint_resume_context_get",
    {
      title: "Get Resume Context",
      description: "Retrieve full resume context for a task+agent pair, including formatted prompt",
      inputSchema: {
        taskId: z.string(),
        agentId: z.string(),
        format: z.enum(["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"]).optional(),
      },
    },
    async ({ taskId, agentId, format }) => {
      try {
        const ctx = getResumeContext(taskId, agentId);
        const prompt = formatResumePrompt(ctx, format ?? "system-prompt");
        return ok({ ...ctx, resumePrompt: prompt });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_search ──
  server.registerTool(
    "syncpoint_project_memory_search",
    {
      title: "Search Project Memory",
      description: "Search approved project memories by keyword",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      try {
        const results = pmSearch(query);
        return ok({ count: results.length, results });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_add ──
  server.registerTool(
    "syncpoint_project_memory_add",
    {
      title: "Add Project Memory",
      description: "Add a new project memory note (created as draft, needs approval to enter context)",
      inputSchema: {
        category: z.enum(["overview", "architecture", "decision", "convention", "risk", "gotcha", "glossary", "file-map", "integration"]),
        title: z.string(),
        content: z.string(),
        scope: z.enum(["project", "domain", "task", "file"]).optional(),
        tags: z.string().optional(),
        sourceType: z.enum(["human", "agent", "checkpoint", "handoff", "doc"]).optional(),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        taskId: z.string().nullable().optional(),
        createdBy: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const data = ProjectMemoryCreateSchema.parse({
          ...input,
          scope: input.scope ?? "project",
          tags: input.tags ?? "",
          sourceType: input.sourceType ?? "agent",
          sourceRef: "",
          confidence: input.confidence ?? "medium",
          taskId: input.taskId ?? null,
          createdBy: input.createdBy ?? "mcp",
        });
        const mem = pmAdd(data);
        return ok({
          ok: true,
          operation: "project_memory_add",
          id: mem.id,
          status: mem.status,
          nextSuggestedAction: `Approve with syncpoint_project_memory_approve(id: "${mem.id}")`,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_approve ──
  server.registerTool(
    "syncpoint_project_memory_approve",
    {
      title: "Approve Project Memory",
      description: "Approve a draft project memory (makes it available in agent resume context)",
      inputSchema: {
        id: z.string(),
        updatedBy: z.string().optional(),
      },
    },
    async ({ id, updatedBy }) => {
      try {
        const mem = pmApprove(id, updatedBy);
        return ok({
          ok: true,
          operation: "project_memory_approve",
          id: mem.id,
          status: mem.status,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_export ──
  server.registerTool(
    "syncpoint_project_memory_export",
    {
      title: "Export Project Memory",
      description: "Export all approved project memories to .syncpoint/project-memory.md",
      inputSchema: { outputPath: z.string().optional() },
    },
    async ({ outputPath }) => {
      try {
        const result = pmExport(outputPath);
        return ok({
          ok: true,
          operation: "project_memory_export",
          path: result.path,
          count: result.count,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_context_prepare ──
  server.registerTool(
    "syncpoint_context_prepare",
    {
      title: "Prepare Context",
      description: "Prepare role-aware context for a given intent. Enforces hard/soft/none gate. Accepts optional relationshipMode to adjust policy.",
      inputSchema: {
        intent: z.enum(ContextIntent.options),
        role: z.enum(ContextRole.options),
        taskId: z.string().optional(),
        agentId: z.string().optional(),
        relationshipMode: z.enum(["manager-delegate", "peer-contract", "handoff-resume"]).optional(),
      },
    },
    async ({ intent, role, taskId, agentId, relationshipMode }) => {
      try {
        const prepared = prepareContext({ intent, role, taskId, agentId, relationshipMode });
        return ok(prepared);
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_context_policy_info ──
  server.registerTool(
    "syncpoint_context_policy_info",
    {
      title: "Context Policy Info",
      description: "List all available context intents, roles, and their policies (gate mode, required/included sections)",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(getContextPolicyInfo());
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_architect_onboarding ──
  server.registerTool(
    "syncpoint_architect_onboarding",
    {
      title: "Architect Onboarding",
      description: "Prepare architect-level context with project memory, task list, and planning guidance",
      inputSchema: {},
    },
    async () => {
      try {
        const prepared = prepareContext({ intent: "architect-plan", role: "architect" });
        return ok(prepared);
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_reviewer_context ──
  server.registerTool(
    "syncpoint_reviewer_context",
    {
      title: "Reviewer Context",
      description: "Prepare reviewer context for a task — includes contract, checkpoint, capsule, and review checklist",
      inputSchema: {
        taskId: z.string(),
        agentId: z.string(),
      },
    },
    async ({ taskId, agentId }) => {
      try {
        const prepared = prepareContext({ intent: "review", role: "reviewer", taskId, agentId });
        return ok(prepared);
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_session_create ──
  server.registerTool(
    "syncpoint_session_create",
    {
      title: "Create Orchestration Session",
      description: "Create a new orchestration session with optional architect role assignment. Specify relationshipMode to define coordination pattern.",
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
      description: "Get full orchestration session status including roles, assignments, reviews, decisions",
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
      description: "Assign a role (architect/executor/reviewer/owner) to an agent within a session",
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
      description: "Plan a task assignment within a session — assigns task to an executor",
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

  // ── Review Workflow Tools ────────────────────────────

  server.registerTool(
    "syncpoint_review_checklist_add",
    {
      title: "Add Checklist Item",
      description: "Add a checklist item to a review request",
      inputSchema: {
        reviewRequestId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
      },
    },
    async ({ reviewRequestId, title, description, required }) => {
      try {
        return ok(rwCreateChecklistItem({ reviewRequestId, title, description, required }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_checklist_update",
    {
      title: "Update Checklist Item",
      description: "Update a checklist item status (PASSED, FAILED, WAIVED, OPEN)",
      inputSchema: {
        itemId: z.string(),
        status: z.enum(["OPEN", "PASSED", "FAILED", "WAIVED"]),
        notes: z.string().optional(),
      },
    },
    async ({ itemId, status, notes }) => {
      try {
        return ok(rwUpdateChecklistItem(itemId, status as ChecklistItemStatus, { notes }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_evidence_add",
    {
      title: "Add Review Evidence",
      description: "Record evidence (build, test, typecheck, manual, etc.) for a review",
      inputSchema: {
        reviewRequestId: z.string(),
        kind: EvidenceKind,
        title: z.string(),
        content: z.string(),
        metadataJson: z.string().optional(),
      },
    },
    async ({ reviewRequestId, kind, title, content, metadataJson }) => {
      try {
        return ok(rwAddEvidence({ reviewRequestId, kind, title, content, metadataJson }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_evidence_list",
    {
      title: "List Review Evidence",
      description: "List all evidence for a review request",
      inputSchema: {
        reviewRequestId: z.string(),
      },
    },
    async ({ reviewRequestId }) => {
      try {
        return ok(rwListEvidence(reviewRequestId));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_changes_request",
    {
      title: "Request Changes",
      description: "Create a change request for a review — blocks approval gate",
      inputSchema: {
        reviewRequestId: z.string(),
        summary: z.string(),
        items: z.string().optional(),
      },
    },
    async ({ reviewRequestId, summary, items }) => {
      try {
        return ok(rwRequestChanges({ reviewRequestId, summary, items }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_changes_address",
    {
      title: "Address Change Request",
      description: "Mark a change request as addressed",
      inputSchema: {
        changeRequestId: z.string(),
        evidenceId: z.string().optional(),
      },
    },
    async ({ changeRequestId, evidenceId }) => {
      try {
        return ok(rwAddressChange({ changeRequestId, evidenceId }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_gate",
    {
      title: "Evaluate Approval Gate",
      description: "Check if a review passes the approval gate",
      inputSchema: {
        reviewRequestId: z.string(),
      },
    },
    async ({ reviewRequestId }) => {
      try {
        return ok(rwEvaluateGate(reviewRequestId));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_approve",
    {
      title: "Approve Review",
      description: "Approve a review (gate must be PASSED)",
      inputSchema: {
        reviewRequestId: z.string(),
        summary: z.string(),
      },
    },
    async ({ reviewRequestId, summary }) => {
      try {
        return ok(rwApproveReview({ reviewRequestId, summary }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_block",
    {
      title: "Block Review",
      description: "Block a review with optional change request",
      inputSchema: {
        reviewRequestId: z.string(),
        summary: z.string(),
        requestedChanges: z.string().optional(),
      },
    },
    async ({ reviewRequestId, summary, requestedChanges }) => {
      try {
        return ok(rwBlockReview({ reviewRequestId, summary, requestedChanges }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_packet",
    {
      title: "Review Packet",
      description: "Get full review packet including checklist, evidence, changes, gate, and context",
      inputSchema: {
        reviewRequestId: z.string(),
      },
    },
    async ({ reviewRequestId }) => {
      try {
        return ok(rwPrepareReviewPacket(reviewRequestId));
      } catch (e) { return fail(e); }
    }
  );

  // ── Playbook Tools ───────────────────────────────

  server.registerTool(
    "syncpoint_next_action",
    {
      title: "Next Action",
      description: "Get the next recommended action for an agent in a session",
      inputSchema: {
        sessionId: z.string(),
        agentId: z.string(),
      },
    },
    async ({ sessionId, agentId }) => {
      try {
        return ok(pbGetNextAction({ sessionId, agentId }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_capture_evidence",
    {
      title: "Capture Evidence",
      description: "Record command output (build/test/lint) as review evidence",
      inputSchema: {
        reviewRequestId: z.string(),
        command: z.string(),
        output: z.string(),
        exitCode: z.number().optional(),
        kind: EvidenceKind.optional(),
      },
    },
    async ({ reviewRequestId, command, output, exitCode, kind }) => {
      try {
        return ok(pbCaptureEvidence({ reviewRequestId, command, output, exitCode, kind }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_active_session",
    {
      title: "Active Session",
      description: "Find the active session for an agent and return next actions",
      inputSchema: {
        agentId: z.string(),
      },
    },
    async ({ agentId }) => {
      try {
        const result = pbGetActiveSession(agentId);
        if (!result) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ active: false }) }] };
        }
        return ok(result);
      } catch (e) { return fail(e); }
    }
  );

  // ═══════════════════════════════════════════════════════
  // Wake Engine Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_wake_list",
    {
      title: "Wake List",
      description: "List wake requests. Filter by session, agent, or status.",
      inputSchema: {
        sessionId: z.string().optional(),
        agentId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ wakeRequests: wakeList(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_next",
    {
      title: "Wake Next",
      description: "Get the next queued wake request for an agent. Returns the action the agent should perform next.",
      inputSchema: {
        agentId: z.string(),
      },
    },
    async ({ agentId }) => {
      try {
        const wake = wakeNext(agentId);
        if (!wake) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ hasWake: false, message: "No pending wake requests." }) }] };
        }
        return ok({ hasWake: true, ...wake });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_ack",
    {
      title: "Wake Acknowledge",
      description: "Acknowledge a wake request — marks it as dispatched.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try { return ok(wakeAck(id)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_start",
    {
      title: "Wake Start",
      description: "Mark a wake request as running — the agent has started executing the action.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try { return ok(wakeStart(id)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_done",
    {
      title: "Wake Done",
      description: "Mark a wake request as done — the agent has completed the action.",
      inputSchema: {
        id: z.string(),
        resultSummary: z.string().optional(),
      },
    },
    async ({ id, resultSummary }) => {
      try { return ok(wakeDone(id, resultSummary)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_fail",
    {
      title: "Wake Fail",
      description: "Mark a wake request as failed.",
      inputSchema: {
        id: z.string(),
        resultSummary: z.string().optional(),
      },
    },
    async ({ id, resultSummary }) => {
      try { return ok(wakeFail(id, resultSummary)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_skip",
    {
      title: "Wake Skip",
      description: "Skip a wake request — marks it as skipped (not applicable).",
      inputSchema: {
        id: z.string(),
        resultSummary: z.string().optional(),
      },
    },
    async ({ id, resultSummary }) => {
      try { return ok(wakeSkip(id, resultSummary)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_stats",
    {
      title: "Wake Engine Stats",
      description: "Get wake engine statistics — events processed, wake requests created, etc.",
    },
    async () => {
      try { return ok(wakeEngineStats()); }
      catch (e) { return fail(e); }
    }
  );

  // ═══════════════════════════════════════════════════════
  // FileClaim / Conflict Awareness Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_file_claim",
    {
      title: "Claim Files",
      description: "Declare file ownership for a task. Returns the claim and any detected conflicts with other agents. Use this BEFORE modifying files to prevent uncoordinated parallel edits.",
      inputSchema: {
        agentId: z.string(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        paths: z.string().describe("Comma-separated file paths or glob patterns, e.g. 'src/auth.ts, src/api/*'"),
        mode: z.enum(["exclusive", "shared"]).optional().describe("exclusive = only this agent may modify; shared = aware of overlap"),
      },
    },
    async ({ agentId, taskId, sessionId, paths, mode }) => {
      try {
        const result = fcClaimFiles({ agentId, taskId, sessionId, paths, mode });
        if (result.conflicts.length > 0) {
          const hardCount = result.conflicts.filter(c => c.isHardConflict).length;
          return ok({
            claim: result.claim,
            warning: hardCount > 0 && result.gateId
              ? `${result.conflicts.length} conflict(s) detected — SyncGate ${result.gateId} auto-created for ${hardCount} hard conflict(s). Agents must sync before continuing.`
              : `${result.conflicts.length} conflict(s) detected — consider creating a sync gate`,
            gateId: result.gateId,
            conflicts: result.conflicts.map(c => ({
              overlap: c.overlappingPath,
              agentA: c.claimA.agentId,
              agentB: c.claimB.agentId,
              isHardConflict: c.isHardConflict,
            })),
          });
        }
        return ok({ claim: result.claim, conflicts: [] });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_file_release",
    {
      title: "Release File Claim",
      description: "Release a file claim — marks it as released so the files are no longer owned by this agent.",
      inputSchema: { claimId: z.string() },
    },
    async ({ claimId }) => {
      try { return ok(fcReleaseClaim(claimId)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_file_list",
    {
      title: "List File Claims",
      description: "List file claims. Filter by agent, task, session, or status.",
      inputSchema: {
        agentId: z.string().optional(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ claims: fcListClaims(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_file_conflicts",
    {
      title: "Detect File Conflicts",
      description: "Check for overlapping file claims among active agents. Returns all conflict pairs with overlap details.",
      inputSchema: {
        sessionId: z.string().optional(),
      },
    },
    async ({ sessionId }) => {
      try {
        const conflicts = fcDetectConflicts(sessionId);
        return ok({
          hasConflicts: conflicts.length > 0,
          count: conflicts.length,
          hardConflicts: conflicts.filter(c => c.isHardConflict).length,
          conflicts: conflicts.map(c => ({
            overlap: c.overlappingPath,
            agentA: c.claimA.agentId,
            agentB: c.claimB.agentId,
            isHardConflict: c.isHardConflict,
          })),
        });
      } catch (e) { return fail(e); }
    }
  );

  // ═══════════════════════════════════════════════════════
  // SyncGate Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_sync_request",
    {
      title: "Request Sync Gate",
      description: "Create a synchronization barrier. All required agents must acknowledge before work can continue. Use when a file conflict is detected, a phase transition needs coordination, or manual sync is needed.",
      inputSchema: {
        taskId: z.string(),
        requestedByAgentId: z.string(),
        requiredAgentIds: z.array(z.string()).min(1).describe("Agent IDs that must acknowledge"),
        sessionId: z.string().optional(),
        reason: z.enum(["file_conflict", "phase_transition", "manual_request", "checkpoint_required", "context_drift"]).optional(),
        description: z.string().optional(),
        relatedFiles: z.string().optional(),
        relatedCheckpointId: z.string().optional(),
        relatedClaimIds: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const result = sgRequest(input);
        return ok({
          gate: result.gate,
          pending: result.pending,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_ack",
    {
      title: "Acknowledge Sync Gate",
      description: "Acknowledge a sync gate as a required agent. Once all required agents acknowledge, the gate can be resolved.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string(),
        summary: z.string().optional().describe("Optional summary of what was confirmed"),
      },
    },
    async ({ gateId, agentId, summary }) => {
      try {
        const result = sgAck(gateId, agentId, summary);
        return ok({
          gate: result.gate,
          pending: result.pending,
          allAcknowledged: result.allAcknowledged,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_resolve",
    {
      title: "Resolve Sync Gate",
      description: "Resolve a sync gate after all agents have acknowledged. Agents may now continue.",
      inputSchema: {
        gateId: z.string(),
        decisionSummary: z.string().optional(),
      },
    },
    async ({ gateId, decisionSummary }) => {
      try {
        const result = sgResolve(gateId, decisionSummary);
        return ok({ gate: result.gate });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_cancel",
    {
      title: "Cancel Sync Gate",
      description: "Cancel a sync gate that is no longer needed.",
      inputSchema: {
        gateId: z.string(),
        reason: z.string().optional(),
      },
    },
    async ({ gateId, reason }) => {
      try { return ok(sgCancel(gateId, reason)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_status",
    {
      title: "Sync Gate Status",
      description: "Get detailed status of a sync gate — pending agents, acknowledgements, blocking state.",
      inputSchema: { gateId: z.string() },
    },
    async ({ gateId }) => {
      try {
        const result = sgStatus(gateId);
        return ok({
          gate: result.gate,
          pending: result.pending,
          allAcknowledged: result.allAcknowledged,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_list",
    {
      title: "List Sync Gates",
      description: "List sync gates. Filter by task, session, or status.",
      inputSchema: {
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ gates: sgList(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_check_agent",
    {
      title: "Check Agent Sync Block",
      description: "Check if an agent is blocked by any active sync gate. Call this before starting work, resuming, or executing a wake request.",
      inputSchema: {
        agentId: z.string(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ agentId, taskId, sessionId }) => {
      try {
        const result = sgCheckAgent(agentId, { taskId, sessionId });
        if (result.blocked) {
          return ok({
            blocked: true,
            message: `Agent is blocked by ${result.blockingGates.length} sync gate(s). Acknowledge or wait for resolution before continuing.`,
            gates: result.blockingGates.map(g => ({
              id: g.id,
              reason: g.reason,
              description: g.description,
              pending: g.requiredAgentIds,
            })),
          });
        }
        return ok({ blocked: false, message: "Agent is not blocked by any sync gate." });
      } catch (e) { return fail(e); }
    }
  );

  // SyncTransaction Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_sync_transaction_create",
    {
      title: "Create Sync Transaction",
      description: "Create a sync transaction for a checkpoint. Automatically creates a bound SyncGate. The requesting agent is blocked until all approvers approve and the transaction is resolved.",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        checkpointId: z.string(),
        requestingAgentId: z.string(),
        requiredApproverIds: z.array(z.string()).min(1).describe("Agent IDs that must approve"),
      },
    },
    async (input) => {
      try {
        const result = stxCreate(input);
        return ok({
          tx: result.tx,
          pending: result.pending,
          isBlocking: result.isBlocking,
          gateId: result.tx.gateId,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_transaction_status",
    {
      title: "Sync Transaction Status",
      description: "Get detailed status of a sync transaction — pending approvers, approval/rejection state, blocking state.",
      inputSchema: { txId: z.string() },
    },
    async ({ txId }) => {
      try {
        const result = stxStatus(txId);
        return ok({
          tx: result.tx,
          pending: result.pending,
          allApproved: result.allApproved,
          hasRejection: result.hasRejection,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_transaction_approve",
    {
      title: "Approve Sync Transaction",
      description: "Approve a sync transaction as a required approver. When all approvers approve, the transaction advances to APPROVED.",
      inputSchema: {
        txId: z.string(),
        agentId: z.string(),
        summary: z.string().optional().describe("Approval summary"),
      },
    },
    async ({ txId, agentId, summary }) => {
      try {
        const result = stxApprove(txId, agentId, summary);
        return ok({
          tx: result.tx,
          pending: result.pending,
          allApproved: result.allApproved,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_transaction_reject",
    {
      title: "Reject Sync Transaction",
      description: "Reject a sync transaction. The requesting agent remains blocked. A follow-up action is required before the transaction can be resolved.",
      inputSchema: {
        txId: z.string(),
        agentId: z.string(),
        reason: z.string().optional().describe("Rejection reason"),
      },
    },
    async ({ txId, agentId, reason }) => {
      try {
        const result = stxReject(txId, agentId, reason);
        return ok({ tx: result.tx });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_transaction_resolve",
    {
      title: "Resolve Sync Transaction",
      description: "Resolve a sync transaction and release the bound SyncGate. The requesting agent may now resume work.",
      inputSchema: {
        txId: z.string(),
        decisionSummary: z.string().optional(),
      },
    },
    async ({ txId, decisionSummary }) => {
      try {
        const result = stxResolve(txId, decisionSummary);
        return ok({ tx: result.tx });
      } catch (e) { return fail(e); }
    }
  );

  // PatchProposal Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_patch_propose",
    {
      title: "Propose Patch",
      description: "Create a draft patch proposal. Submit a unified diff and SyncPoint will extract touched files and check ownership/conflicts before allowing application.",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        agentId: z.string(),
        title: z.string(),
        summary: z.string().optional(),
        patchText: z.string().describe("Unified diff patch text"),
      },
    },
    async (input) => {
      try {
        const result = ppPropose(input);
        return ok({ proposal: result });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_submit",
    {
      title: "Submit Patch",
      description: "Submit a draft patch for ownership/conflict checking. Auto-runs checks and moves to SUBMITTED or CONFLICTING.",
      inputSchema: { patchId: z.string() },
    },
    async ({ patchId }) => {
      try {
        const result = ppSubmit(patchId);
        return ok({
          proposal: result.proposal,
          checkResult: result.checkResult,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_check",
    {
      title: "Check Patch",
      description: "Run ownership/conflict checks on a patch proposal without changing its status.",
      inputSchema: { patchId: z.string() },
    },
    async ({ patchId }) => {
      try {
        const result = ppCheck(patchId);
        return ok({
          proposal: result.proposal,
          checkResult: result.checkResult,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_approve",
    {
      title: "Approve Patch",
      description: "Approve a submitted patch proposal. The patch can then be applied.",
      inputSchema: {
        patchId: z.string(),
        agentId: z.string(),
        summary: z.string().optional(),
      },
    },
    async ({ patchId, agentId, summary }) => {
      try {
        return ok({ proposal: ppApprove(patchId, agentId, summary) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_reject",
    {
      title: "Reject Patch",
      description: "Reject a submitted patch proposal. The agent can fix and resubmit.",
      inputSchema: {
        patchId: z.string(),
        agentId: z.string(),
        reason: z.string().optional(),
      },
    },
    async ({ patchId, agentId, reason }) => {
      try {
        return ok({ proposal: ppReject(patchId, agentId, reason) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_apply",
    {
      title: "Apply Patch",
      description: "Mark an approved patch as applied.",
      inputSchema: { patchId: z.string() },
    },
    async ({ patchId }) => {
      try {
        return ok({ proposal: ppApply(patchId) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_status",
    {
      title: "Patch Status",
      description: "Get patch proposal status with check results.",
      inputSchema: { patchId: z.string() },
    },
    async ({ patchId }) => {
      try {
        const result = ppStatus(patchId);
        return ok({
          proposal: result.proposal,
          checkResult: result.checkResult,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_patch_list",
    {
      title: "List Patches",
      description: "List patch proposals. Filter by session, task, agent, or status.",
      inputSchema: {
        sessionId: z.string().optional(),
        taskId: z.string().optional(),
        agentId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return ok({ proposals: ppList(input) });
      } catch (e) { return fail(e); }
    }
  );
}
