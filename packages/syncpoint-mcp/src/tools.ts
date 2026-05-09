/**
 * MCP tools — state-mutating operations exposed to LLM clients.
 * All tools delegate to application layer use cases.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loopStatus, loopResume, loopCheckpoint, loopHandoff,
  pmAdd, pmApprove, pmSearch, pmExport, pmSupersede, pmGetVersion,
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
  rcClaim, rcRelease, rcList, rcDetectConflicts,
  sgRequest, sgAck, sgResolve, sgCancel, sgStatus, sgStatusDetailed, sgList, sgListActive, sgCheckAgent, sgVote,
  stxCreate, stxApprove, stxReject, stxResolve, stxCancel, stxStatus, stxList,
  opCreate, opSubmit, opCheck, opApprove, opReject, opApply, opCancel, opStatus, opList,
  writeCheck, writePrepare, writeApply,
  guardStatus, guardCreateSession,
  constraintCheck,
} from "syncpoint-server/application";
import { getResumeContext, createRuntime, getRuntime, listRuntimes, updateRuntimeAgent, updateAgentRuntime, getAgent } from "syncpoint-server/repositories";
import { formatResumePrompt, ProjectMemoryCreateSchema, ContextIntent, ContextRole, OrchestratorRole, ReviewVerdict, EvidenceKind, PlaybookActionKind, RuntimeKind, WriteIntent } from "syncpoint-core";
import type { ChecklistItemStatus } from "syncpoint-core";
import { safeError } from "./errors.js";
import { formatToolResult } from "./format.js";
import { resolveBoundAgentId, getConnectionIdentity, isBound } from "./identity.js";

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
      description: "Get current agent and task status. agentId is optional if connection is identity-bound.",
      inputSchema: { agentId: z.string().optional(), taskId: z.string().optional() },
    },
    async ({ agentId, taskId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        return ok(loopStatus({ agentId: resolved, taskId }));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_loop_resume ──
  server.registerTool(
    "syncpoint_loop_resume",
    {
      title: "Loop Resume",
      description: "Resume a task — enforces context policy, generates adapter files and prompt. agentId is optional if connection is identity-bound. contextMode: capsule-first (default), capsule-only (no raw checkpoint/project memory), capsule-locked (hard-block on any validation failure).",
      inputSchema: {
        agentId: z.string().optional(),
        taskId: z.string(),
        provider: z.string().optional(),
        format: z.enum(["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"]).optional(),
        contextMode: z.enum(["capsule-first", "capsule-only", "capsule-locked"]).optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ agentId, taskId, provider, format, contextMode, sessionId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        return ok(loopResume({ agentId: resolved, taskId, provider, format, contextMode: contextMode as any, sessionId }));
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_loop_checkpoint ──
  server.registerTool(
    "syncpoint_loop_checkpoint",
    {
      title: "Loop Checkpoint",
      description: "Save a checkpoint and context capsule for the current work session. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
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
        workingResources: z.string().optional(),
        resumePrompt: z.string().optional(),
        needSync: z.boolean().optional(),
        provider: z.string().optional(),
      },
    },
    async (input) => {
      try {
        const resolved = resolveBoundAgentId(input.agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        return ok(loopCheckpoint({ ...input, agentId: resolved }));
      } catch (e) { return fail(e); }
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
        ctx.projectMemories = []; // P3B: no raw PM in resume output
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
        createdBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
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
          createdBy: input.createdBy || resolveBoundAgentId() || (() => { throw new Error("createdBy is required. Provide it explicitly or bind an agent first."); })(),
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
        updatedBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async ({ id, updatedBy }) => {
      try {
        const caller = updatedBy || resolveBoundAgentId() || "";
        const mem = pmApprove(id, caller);
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
      inputSchema: {
        outputPath: z.string().optional(),
        callerBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async ({ outputPath, callerBy }) => {
      try {
        const caller = callerBy || resolveBoundAgentId() || "";
        const result = pmExport(outputPath, caller);
        return ok({
          ok: true,
          operation: "project_memory_export",
          path: result.path,
          count: result.count,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_supersede ──
  server.registerTool(
    "syncpoint_project_memory_supersede",
    {
      title: "Supersede Project Memory",
      description: "Mark a new memory as replacing an old one. The old memory is deprecated with a supersededBy link.",
      inputSchema: {
        newId: z.string().describe("ID of the new (replacement) memory"),
        oldId: z.string().describe("ID of the old memory to supersede"),
        updatedBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async ({ newId, oldId, updatedBy }) => {
      try {
        const caller = updatedBy || resolveBoundAgentId() || "";
        const { newMem, oldMem } = pmSupersede(newId, oldId, caller);
        return ok({
          ok: true,
          operation: "project_memory_supersede",
          newId: newMem.id,
          oldId: oldMem.id,
          oldStatus: oldMem.status,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_version ──
  server.registerTool(
    "syncpoint_project_memory_version",
    {
      title: "Project Memory Version",
      description: "Get the current approved memory set version counter. Bumps on approve, deprecate, supersede.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({ memoryVersion: pmGetVersion() });
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
      description: "Get the next recommended action for an agent in a session. agentId is optional if connection is identity-bound.",
      inputSchema: {
        sessionId: z.string(),
        agentId: z.string().optional(),
      },
    },
    async ({ sessionId, agentId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        return ok(pbGetNextAction({ sessionId, agentId: resolved }));
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
      description: "Find the active session for an agent and return next actions. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
      },
    },
    async ({ agentId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const result = pbGetActiveSession(resolved);
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
      description: "Get the next queued wake request for an agent. Returns the action the agent should perform next. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
      },
    },
    async ({ agentId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const wake = wakeNext(resolved);
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
  // ResourceClaim / Conflict Awareness Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_resource_claim",
    {
      title: "Claim Resources",
      description: "Declare resource ownership for a task. Returns the claim and any detected conflicts with other agents. Use this BEFORE modifying resources to prevent uncoordinated parallel edits. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        locators: z.string().optional().describe("Comma-separated resource locators, e.g. 'src/auth.ts, src/api/*' or 'assets/hero.png'"),
        paths: z.string().optional().describe("(deprecated, use locators) Comma-separated file paths — kept for backward compatibility"),
        type: z.string().optional().describe("Resource type (default: 'file'). Use 'binary_asset', 'db_table', etc. for non-code resources"),
        mode: z.enum(["exclusive", "shared"]).optional().describe("exclusive = only this agent may modify; shared = aware of overlap"),
      },
    },
    async ({ agentId, taskId, sessionId, locators, paths, type, mode }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const rawLocators = locators || paths;
        if (!rawLocators) return fail(new Error("locators (or paths) is required"));
        const resourceType = type || "file";
        const resources = rawLocators.split(",").map((p: string) => ({
          type: resourceType,
          locator: p.trim(),
          metadata: "",
        }));
        const result = rcClaim({ actorId: resolved, taskId, sessionId, resources, mode });
        if (result.conflicts.length > 0) {
          return ok({
            claim: result.claim,
            warning: result.gateId
              ? `${result.conflicts.length} conflict(s) detected — SyncGate ${result.gateId} auto-created. Agents must sync before continuing.`
              : `${result.conflicts.length} conflict(s) detected — consider creating a sync gate`,
            gateId: result.gateId,
            conflicts: result.conflicts.map((c: any) => ({
              overlap: c.overlappingLocator,
              actorA: c.claimA.actorId,
              actorB: c.claimB.actorId,
            })),
          });
        }
        return ok({ claim: result.claim, conflicts: [] });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_resource_release",
    {
      title: "Release Resource Claim",
      description: "Release a resource claim — marks it as released so the resources are no longer owned by this agent.",
      inputSchema: { claimId: z.string() },
    },
    async ({ claimId }) => {
      try { return ok(rcRelease(claimId)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_resource_list",
    {
      title: "List Resource Claims",
      description: "List resource claims. Filter by actor, task, session, or status.",
      inputSchema: {
        actorId: z.string().optional(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ claims: rcList(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_resource_conflicts",
    {
      title: "Detect Resource Conflicts",
      description: "Check for overlapping resource claims among active agents. Returns all conflict pairs with overlap details.",
      inputSchema: {
        sessionId: z.string().optional(),
      },
    },
    async ({ sessionId }) => {
      try {
        const conflicts = rcDetectConflicts(sessionId ? { sessionId } : undefined);
        return ok({
          hasConflicts: conflicts.length > 0,
          count: conflicts.length,
          conflicts: conflicts.map((c: any) => ({
            overlap: c.overlappingLocator,
            actorA: c.claimA.actorId,
            actorB: c.claimB.actorId,
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
      description: "Create a synchronization barrier. All required agents must acknowledge before work can continue. Use when a resource conflict is detected, a phase transition needs coordination, or manual sync is needed.",
      inputSchema: {
        taskId: z.string(),
        requestedByAgentId: z.string(),
        requiredAgentIds: z.array(z.string()).min(1).describe("Agent IDs that must acknowledge"),
        sessionId: z.string().optional(),
        reason: z.enum(["resource_conflict", "phase_transition", "manual_request", "checkpoint_required", "context_drift"]).optional(),
        description: z.string().optional(),
        relatedResources: z.string().optional(),
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
      description: "Acknowledge a sync gate as a required agent. Once all required agents acknowledge, the gate can be resolved. agentId is optional if connection is identity-bound.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string().optional(),
        summary: z.string().optional().describe("Optional summary of what was confirmed"),
      },
    },
    async ({ gateId, agentId, summary }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const result = sgAck(gateId, resolved, summary);
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
      description: "Get full detailed status of a sync gate — policy, votes, pending/acked agents, eligible voters, deadline, liveness preview, and available actions for a specific agent.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string().optional().describe("If provided, includes available actions for this agent"),
      },
    },
    async ({ gateId, agentId }) => {
      try {
        const detail = sgStatusDetailed(gateId, agentId);
        return ok(detail);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_vote",
    {
      title: "Cast Sync Gate Vote",
      description: "Cast or change a vote on a sync gate. Only eligible voters (required agents, owner, escalation agents) may vote. Vote kinds: approve, reject, abstain, escalate.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string(),
        vote: z.enum(["approve", "reject", "abstain", "escalate"]),
        summary: z.string().optional().default(""),
      },
    },
    async ({ gateId, agentId, vote, summary }) => {
      try {
        const result = sgVote(gateId, agentId, vote, summary);
        return ok({
          gate: result.gate,
          pending: result.pending,
          isBlocking: result.isBlocking,
          message: `Vote '${vote}' cast by ${agentId} on gate ${gateId}. Gate status: ${result.gate.status}.`,
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

  // Operation Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_operation_create",
    {
      title: "Create Operation",
      description: "Create a draft operation (e.g. code patch). Submit content and SyncPoint will track touched resources and check ownership/conflicts before allowing application.",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        actorId: z.string(),
        title: z.string(),
        type: z.string().optional().describe("Operation type, e.g. 'code_patch'"),
        summary: z.string().optional(),
        payload: z.string().optional().describe("Operation payload (e.g. unified diff patch text)"),
      },
    },
    async (input) => {
      try {
        const result = opCreate({ ...input, type: input.type || "code_patch" });
        return ok({ operation: result });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_submit",
    {
      title: "Submit Operation",
      description: "Submit a draft operation for checking. Auto-runs checks and moves to SUBMITTED or CONFLICTING.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        const result = opSubmit(operationId);
        return ok({ operation: result.operation, checkResult: result.checkResult });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_check",
    {
      title: "Check Operation",
      description: "Run checks on an operation without changing its status.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        const result = opCheck(operationId);
        return ok({ operation: result.operation, checkResult: result.checkResult });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_approve",
    {
      title: "Approve Operation",
      description: "Approve a submitted operation. The operation can then be applied.",
      inputSchema: {
        operationId: z.string(),
        actorId: z.string(),
        summary: z.string().optional(),
      },
    },
    async ({ operationId, actorId, summary }) => {
      try {
        return ok({ operation: opApprove(operationId, actorId, summary) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_reject",
    {
      title: "Reject Operation",
      description: "Reject a submitted operation. The actor can fix and resubmit.",
      inputSchema: {
        operationId: z.string(),
        actorId: z.string(),
        reason: z.string().optional(),
      },
    },
    async ({ operationId, actorId, reason }) => {
      try {
        return ok({ operation: opReject(operationId, actorId, reason) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_apply",
    {
      title: "Apply Operation",
      description: "Mark an approved operation as applied.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        return ok({ operation: opApply(operationId) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_cancel",
    {
      title: "Cancel Operation",
      description: "Cancel an operation.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        return ok({ operation: opCancel(operationId) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_status",
    {
      title: "Operation Status",
      description: "Get operation status with check results.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        const result = opStatus(operationId);
        return ok({ operation: result.operation, checkResult: result.checkResult });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_list",
    {
      title: "List Operations",
      description: "List operations. Filter by type, actor, task, session, or status.",
      inputSchema: {
        type: z.string().optional(),
        actorId: z.string().optional(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return ok({ operations: opList(input) });
      } catch (e) { return fail(e); }
    }
  );

  // Controlled Write Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_write_check",
    {
      title: "Check Controlled Write",
      description: "Dry-run a controlled write decision. Returns permit decision, blockers, and base hashes without writing files.",
      inputSchema: {
        actorId: z.string().optional(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        locators: z.array(z.string()).min(1),
        type: z.string().optional().default("file"),
        intent: z.enum(["create", "modify", "delete", "rename", "bulk"]).optional().default("modify"),
        operationId: z.string().optional(),
      },
    },
    async ({ actorId, taskId, sessionId, locators, type, intent, operationId }) => {
      try {
        const resolved = resolveBoundAgentId(actorId);
        if (!resolved) return fail(new Error("actorId required (no bound identity)"));
        return ok(writeCheck({
          actorId: resolved,
          taskId,
          sessionId,
          resources: locators.map(locator => ({ type: type ?? "file", locator, metadata: "" })),
          intent: (intent ?? "modify") as WriteIntent,
          operationId,
        }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_write_prepare",
    {
      title: "Prepare Controlled Write",
      description: "Issue a short-lived write permit if claims, gates, operations, constraints, and hashes allow the write.",
      inputSchema: {
        actorId: z.string().optional(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        locators: z.array(z.string()).min(1),
        type: z.string().optional().default("file"),
        intent: z.enum(["create", "modify", "delete", "rename", "bulk"]).optional().default("modify"),
        operationId: z.string().optional(),
        ttlSeconds: z.number().int().min(1).optional(),
      },
    },
    async ({ actorId, taskId, sessionId, locators, type, intent, operationId, ttlSeconds }) => {
      try {
        const resolved = resolveBoundAgentId(actorId);
        if (!resolved) return fail(new Error("actorId required (no bound identity)"));
        return ok(writePrepare({
          actorId: resolved,
          taskId,
          sessionId,
          resources: locators.map(locator => ({ type: type ?? "file", locator, metadata: "" })),
          intent: (intent ?? "modify") as WriteIntent,
          operationId,
          ttlSeconds,
        }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_write_apply",
    {
      title: "Apply Controlled Write",
      description: "Apply file mutations through an issued write permit. This is the L1 hard-blocking write path.",
      inputSchema: {
        permitId: z.string(),
        mutations: z.array(z.object({
          locator: z.string(),
          content: z.string().optional(),
          contentBase64: z.string().optional(),
          delete: z.boolean().optional(),
        })).min(1),
      },
    },
    async ({ permitId, mutations }) => {
      try {
        return ok(writeApply({
          permitId,
          mutations: mutations.map(mutation => ({
            resource: { type: "file", locator: mutation.locator, metadata: "" },
            content: mutation.content,
            contentBase64: mutation.contentBase64,
            delete: mutation.delete,
          })),
        }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_guard_status",
    {
      title: "Guard Status",
      description: "Show guarded workspace status, active guard sessions, and native proxy adapter availability.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(guardStatus());
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_guard_session_create",
    {
      title: "Create Guard Session",
      description: "Create a local guard capability token for editor/proxy adapters. This does not mount a native filesystem by itself.",
      inputSchema: {
        actorId: z.string(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        mode: z.enum(["observe", "stage", "strict", "readonly"]).optional(),
        mountPath: z.string().optional(),
        adapter: z.enum(["winfsp", "fuse", "macfuse", "manual"]).optional(),
        ttlSeconds: z.number().int().min(1).optional(),
      },
    },
    async (input) => {
      try {
        return ok(guardCreateSession(input));
      } catch (e) { return fail(e); }
    }
  );

  // ══════════════════════════════════════════════════════════
  // ── P4D Constraint Runtime (read-only visibility) ────────
  // ══════════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_constraint_check",
    {
      title: "Constraint Check",
      description:
        "Query the Constraint Runtime to check if an action is permitted. " +
        "Returns blockers, warnings, and projection metadata. Read-only — does not change any state. " +
        "Use this before executing to understand if and why you might be blocked.",
      inputSchema: {
        action: z.enum(["resume", "start_assignment", "wake_start", "operation_submit", "operation_apply"])
          .describe("The action to evaluate"),
        taskId: z.string().optional().describe("Task ID (required for resume, wake_start)"),
        agentId: z.string().optional().describe("Agent ID (required for resume, wake_start without wakeRequestId)"),
        sessionId: z.string().optional(),
        assignmentId: z.string().optional().describe("Assignment ID (required for start_assignment)"),
        wakeRequestId: z.string().optional().describe("Wake request ID (alternative to taskId+agentId for wake_start)"),
        operationId: z.string().optional().describe("Operation ID (required for operation_submit/operation_apply)"),
        touchedResources: z.array(z.string()).optional().describe("Override touched resources for debug/preview"),
      },
    },
    async (input) => {
      try {
        const result = constraintCheck(input as any);
        return ok(result);
      } catch (e) { return fail(e); }
    }
  );

  // ══════════════════════════════════════════════════════════
  // ── Runtime Identity (P11) ───────────────────────────────
  // ══════════════════════════════════════════════════════════

  // ── syncpoint_whoami ──
  server.registerTool(
    "syncpoint_whoami",
    {
      title: "Who Am I",
      description:
        "Returns the identity of this MCP connection: bound agentId, runtimeId, provider, and workspace. " +
        "Use this to confirm which agent this connection is speaking as.",
      inputSchema: {},
    },
    async () => {
      try {
        const identity = getConnectionIdentity();
        const envAgent = process.env.SYNCPOINT_AGENT_ID ?? null;
        const envRuntime = process.env.SYNCPOINT_RUNTIME_ID ?? null;
        const workspaceRoot = process.env.SYNCPOINT_PROJECT_ROOT ?? process.cwd();

        let agent = null;
        if (identity?.agentId) {
          try { agent = getAgent(identity.agentId); } catch { /* not found */ }
        }

        return ok({
          bound: isBound(),
          agentId: identity?.agentId ?? null,
          agentName: agent?.name ?? null,
          provider: agent?.provider ?? null,
          role: agent?.role ?? null,
          runtimeId: envRuntime,
          source: identity?.source ?? "none",
          workspaceRoot,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_register ──
  server.registerTool(
    "syncpoint_runtime_register",
    {
      title: "Register Runtime",
      description:
        "Register a new runtime instance. A runtime represents a physical editor window or daemon " +
        "that connects to SyncPoint. Optionally bind it to an agent.",
      inputSchema: {
        name: z.string().describe("Human-readable runtime name, e.g. 'architect-window'"),
        kind: z.enum(["local-mcp", "daemon", "cloud"]).optional().describe("Runtime kind"),
        provider: z.string().optional().describe("Editor/AI provider (copilot, cursor, codex, etc.)"),
        host: z.string().optional().describe("Machine/workstation name"),
        workspaceRoot: z.string().optional().describe("Workspace root path"),
        agentId: z.string().optional().describe("Agent to bind to this runtime"),
      },
    },
    async (input) => {
      try {
        if (input.agentId) {
          getAgent(input.agentId); // verify agent exists before creating runtime
        }
        const rt = createRuntime({
          name: input.name,
          kind: (input.kind as any) ?? RuntimeKind.LOCAL_MCP,
          provider: input.provider ?? "",
          host: input.host ?? "",
          workspaceRoot: input.workspaceRoot ?? "",
          agentId: input.agentId ?? null,
        });
        if (input.agentId) {
          updateAgentRuntime(input.agentId, rt.id);
        }
        return ok({ runtime: rt, hint: `Set SYNCPOINT_RUNTIME_ID=${rt.id} in your MCP config.` });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_bind ──
  server.registerTool(
    "syncpoint_runtime_bind",
    {
      title: "Bind Agent to Runtime",
      description: "Bind an agent to a runtime. Future connections with that runtime ID will automatically act as this agent.",
      inputSchema: {
        runtimeId: z.string().describe("Runtime ID to bind"),
        agentId: z.string().describe("Agent ID to bind to the runtime"),
      },
    },
    async ({ runtimeId, agentId }) => {
      try {
        getAgent(agentId); // verify agent exists
        const rt = updateRuntimeAgent(runtimeId, agentId);
        updateAgentRuntime(agentId, runtimeId);
        return ok({ runtime: rt });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_list ──
  server.registerTool(
    "syncpoint_runtime_list",
    {
      title: "List Runtimes",
      description: "List all registered runtime instances.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({ runtimes: listRuntimes() });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_status ──
  server.registerTool(
    "syncpoint_runtime_status",
    {
      title: "Runtime Status",
      description: "Get details of a specific runtime instance.",
      inputSchema: {
        runtimeId: z.string().describe("Runtime ID"),
      },
    },
    async ({ runtimeId }) => {
      try {
        const rt = getRuntime(runtimeId);
        let agent = null;
        if (rt.agentId) {
          try { agent = getAgent(rt.agentId); } catch { /* not found */ }
        }
        return ok({ runtime: rt, boundAgent: agent });
      } catch (e) { return fail(e); }
    }
  );
}
