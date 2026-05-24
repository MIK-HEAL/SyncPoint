/**
 * Context Policy Service — role-aware context preparation.
 * CLI, MCP, and tRPC all share this layer.
 */

import {
  getContextPolicy,
  getContextPolicyForMode,
  CONTEXT_POLICIES,
  listContextIntents,
  listContextRoles,
} from "syncpoint-core";
import type { RelationshipModeStr } from "syncpoint-core";
import type {
  ContextIntent,
  ContextRole,
  ContextGateMode,
  ContextPolicy,
  ContextPolicyCheck,
  ContextSection,
  PreparedContext,
  ResumeContext,
  ProjectMemory,
  ContextSnapshot,
  Handoff,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { pmList } from "./project-memory-service.js";
import {
  formatArchitectPrompt as formatArchitectPromptImpl,
  formatExecutePrompt as formatExecutePromptImpl,
  formatHandoffReceivePrompt as formatHandoffReceivePromptImpl,
  formatMemoryReviewPrompt as formatMemoryReviewPromptImpl,
  formatOnboardPrompt as formatOnboardPromptImpl,
  formatReviewPrompt as formatReviewPromptImpl,
} from "./context-policy-prompt-formatters.js";

// ── Types ────────────────────────────────────────────

export interface PrepareContextInput {
  intent: ContextIntent;
  role: ContextRole;
  taskId?: string;
  agentId?: string;
  relationshipMode?: RelationshipModeStr;
}

export interface ContextPolicyInfo {
  intents: ContextIntent[];
  roles: ContextRole[];
  policies: ContextPolicy[];
}

// ── Helpers ──────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function checkSection(
  section: ContextSection,
  present: boolean,
  required: boolean,
): ContextPolicyCheck {
  if (required && !present) {
    return { section, present: false, required: true, message: `Missing required: ${section}` };
  }
  if (!present) {
    return { section, present: false, required: false, message: `Not available: ${section}` };
  }
  return { section, present: true, required, message: "OK" };
}

// ── Prompt Formatters ────────────────────────────────

function formatExecutePrompt(
  ctx: ResumeContext,
  policy: ContextPolicy,
): string {
  return formatExecutePromptImpl(ctx, policy);
}

function formatReviewPrompt(
  task: { id: string; title: string; status: string } | null,
  snapshot: ResumeContext["latestSnapshot"],
  checkpoint: ResumeContext["latestCheckpoint"],
  contract: ResumeContext["approvedContract"],
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
): string {
  return formatReviewPromptImpl(task, snapshot, checkpoint, contract, projectMems);
}

function formatArchitectPrompt(
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
  tasks: Array<{ id: string; title: string; status: string; ownerAgentId: string | null }>,
): string {
  return formatArchitectPromptImpl(projectMems, tasks);
}

function formatHandoffReceivePrompt(
  task: { id: string; title: string; status: string } | null,
  agent: { id: string; name: string; role: string } | null,
  handoff: Handoff | null,
  senderSnapshot: ContextSnapshot | null,
  receiverResume: ResumeContext | null,
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
): string {
  return formatHandoffReceivePromptImpl(task, agent, handoff, senderSnapshot, receiverResume, projectMems);
}

function formatOnboardPrompt(
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
  tasks: Array<{ id: string; title: string; status: string; ownerAgentId: string | null }>,
  agents: Array<{ id: string; name: string; role: string; status: string }>,
): string {
  return formatOnboardPromptImpl(projectMems, tasks, agents);
}

function formatMemoryReviewPrompt(
  approved: ProjectMemory[],
  drafts: ProjectMemory[],
  deprecated: ProjectMemory[],
): string {
  return formatMemoryReviewPromptImpl(approved, drafts, deprecated);
}

// ── Main Use Cases ───────────────────────────────────

/**
 * Prepare context for a given intent+role, enforcing the appropriate gate.
 */
export function prepareContext(input: PrepareContextInput): PreparedContext {
  const policy = getContextPolicyForMode(input.intent, input.relationshipMode);
  const allSections = [...policy.requiredSections, ...policy.includeSections];
  const checks: ContextPolicyCheck[] = [];
  const missingSections: ContextSection[] = [];
  const warnings: string[] = [];

  // ── Gather data ──
  let resumeCtx: ResumeContext | null = null;
  let taskInfo: PreparedContext["task"] = null;
  let agentInfo: PreparedContext["agent"] = null;
  let handoff: Handoff | null = null;
  let senderSnapshot: ContextSnapshot | null = null;

  // Task-scoped intents need task+agent
  const needsTask = allSections.some(s =>
    ["task", "latest-snapshot", "latest-checkpoint", "approved-contract", "handoff-context"].includes(s)
  );
  const needsAgent = allSections.includes("agent") || needsTask;

  if (needsTask && input.taskId && input.agentId) {
    try {
      resumeCtx = repo.getResumeContext(input.taskId, input.agentId);
      taskInfo = resumeCtx.task;
      agentInfo = resumeCtx.agent;
      if (input.intent === "handoff-receive") {
        handoff = repo.getLatestHandoffForReceiver(input.taskId, input.agentId) ?? null;
        if (handoff) {
          senderSnapshot = repo.getLatestContextSnapshot(input.taskId, handoff.fromAgentId) ?? null;
        }
      }
    } catch {
      warnings.push("Failed to load resume context — task or agent not found.");
    }
  } else if (needsAgent && input.agentId) {
    try {
      const agent = repo.getAgent(input.agentId);
      agentInfo = { id: agent.id, name: agent.name, role: agent.role };
    } catch {
      warnings.push("Agent not found.");
    }
  }

  // Project memories (approved)
  const approvedMems = pmList({ status: "approved" }).map(m => ({
    id: m.id, category: m.category, title: m.title, content: m.content,
  }));

  // Draft + deprecated memories (for memory-review)
  const draftMems = allSections.includes("draft-memories")
    ? pmList({ status: "draft" }) : [];
  const deprecatedMems = allSections.includes("deprecated-memories")
    ? pmList({ status: "deprecated" }) : [];

  // Task list and agent list
  const taskList = allSections.includes("task-list")
    ? repo.listTasks().map(t => ({ id: t.id, title: t.title, status: t.status, ownerAgentId: t.ownerAgentId }))
    : [];
  const agentList = allSections.includes("agent-list")
    ? repo.listAgents().map(a => ({ id: a.id, name: a.name, role: a.role, status: a.status }))
    : [];

  // ── Check required sections ──
  for (const section of policy.requiredSections) {
    let present = false;
    switch (section) {
      case "task":
        present = taskInfo !== null;
        break;
      case "agent":
        present = agentInfo !== null;
        break;
      case "latest-snapshot":
        present = input.intent === "handoff-receive"
          ? !!(resumeCtx?.latestSnapshot || senderSnapshot || handoff?.contextSummary)
          : resumeCtx?.latestSnapshot !== null && resumeCtx?.latestSnapshot !== undefined;
        break;
      case "latest-checkpoint":
        present = resumeCtx?.latestCheckpoint !== null && resumeCtx?.latestCheckpoint !== undefined;
        break;
      case "approved-contract":
        present = resumeCtx?.approvedContract !== null && resumeCtx?.approvedContract !== undefined;
        break;
      case "handoff-context":
        present = !!handoff?.contextSummary;
        break;
      case "approved-project-memory":
        present = approvedMems.length > 0;
        break;
      case "pinned-memory":
        present = (resumeCtx?.pinnedMemories?.length ?? 0) > 0;
        break;
      case "task-list":
        present = taskList.length > 0;
        break;
      case "agent-list":
        present = agentList.length > 0;
        break;
      case "draft-memories":
        present = draftMems.length > 0;
        break;
      case "deprecated-memories":
        present = deprecatedMems.length > 0;
        break;
      default:
        present = false;
    }

    const check = checkSection(section, present, true);
    checks.push(check);
    if (!present) {
      missingSections.push(section);
      warnings.push(check.message);
    }
  }

  // ── Check included (non-required) sections ──
  for (const section of policy.includeSections) {
    if (policy.requiredSections.includes(section)) continue;
    let present = false;
    switch (section) {
      case "approved-contract":
        present = resumeCtx?.approvedContract !== null && resumeCtx?.approvedContract !== undefined;
        break;
      case "approved-project-memory":
        present = approvedMems.length > 0;
        break;
      case "pinned-memory":
        present = (resumeCtx?.pinnedMemories?.length ?? 0) > 0;
        break;
      case "task-list":
        present = taskList.length > 0;
        break;
      case "agent-list":
        present = agentList.length > 0;
        break;
      case "handoff-context":
        present = !!handoff?.contextSummary;
        break;
      case "draft-memories":
        present = draftMems.length > 0;
        break;
      case "deprecated-memories":
        present = deprecatedMems.length > 0;
        break;
      case "open-decisions":
        present = approvedMems.some(m => m.category === "decision");
        break;
      case "risks":
        present = approvedMems.some(m => m.category === "risk") ||
          (() => { const p = resumeCtx?.latestSnapshot?.payload; return Array.isArray(p?.risks) && p.risks.length > 0; })();
        break;
      default:
        present = false;
    }
    checks.push(checkSection(section, present, false));
  }

  // ── Gate decision ──
  const ready = policy.gateMode === "none"
    ? true
    : missingSections.length === 0;
  const isResumeIntent = input.intent === "execute" || input.intent === "resume" || input.intent === "handoff-receive";
  const shouldUseResumeQualityGate = input.intent === "execute" || input.intent === "resume";
  const resumeReady = shouldUseResumeQualityGate ? (resumeCtx?.ready ?? true) : true;
  const finalReady = policy.gateMode === "hard"
    ? ready && resumeReady
    : ready;

  if (policy.gateMode === "hard" && shouldUseResumeQualityGate && resumeCtx && !resumeCtx.ready) {
    warnings.push(...resumeCtx.warnings);
  }

  // ── Format prompt ──
  let prompt = "";
  switch (input.intent) {
    case "execute":
    case "resume":
    case "handoff-receive":
      // P3B: no raw project memories in agent-facing resume prompts
      prompt = formatHandoffReceivePrompt(taskInfo, agentInfo, handoff, senderSnapshot, resumeCtx, []);
      break;
    case "review":
      prompt = formatReviewPrompt(
        taskInfo, resumeCtx?.latestSnapshot ?? null, resumeCtx?.latestCheckpoint ?? null,
        resumeCtx?.approvedContract ?? null, approvedMems,
      );
      break;
    case "architect-plan":
      prompt = formatArchitectPrompt(approvedMems, taskList);
      break;
    case "project-onboard":
      prompt = formatOnboardPrompt(approvedMems, taskList, agentList);
      break;
    case "memory-review":
      prompt = formatMemoryReviewPrompt(approvedMems as any, draftMems, deprecatedMems);
      break;
  }

  // ── Suggested actions ──
  const suggestedNextActions: string[] = [];
  if (missingSections.includes("latest-snapshot")) {
    suggestedNextActions.push("Create a context snapshot: syncpoint_loop_checkpoint or `syncpoint loop checkpoint`");
  }
  if (missingSections.includes("latest-checkpoint")) {
    suggestedNextActions.push("Create a checkpoint first: syncpoint_loop_checkpoint");
  }
  if (missingSections.includes("approved-project-memory")) {
    suggestedNextActions.push("Add project memories: syncpoint_project_memory_add");
  }
  if (missingSections.includes("approved-contract")) {
    suggestedNextActions.push("Create and approve a peer contract");
  }
  if (input.intent === "memory-review") {
    suggestedNextActions.push("Approve draft memories: syncpoint_project_memory_approve");
    suggestedNextActions.push("Export to file: syncpoint_project_memory_export");
  }

  return {
    intent: input.intent,
    role: input.role,
    gateMode: policy.gateMode,
    ready: finalReady,
    missingSections,
    checks,
    warnings,
    task: taskInfo,
    agent: agentInfo,
    // P3B: strip raw PM from structured return for agent-facing intents
    resumeContext: isResumeIntent && resumeCtx
      ? { ...resumeCtx, projectMemories: [], resumePrompt: "" }
      : resumeCtx,
    handoffContext: handoff ? {
      id: handoff.id,
      fromAgentId: handoff.fromAgentId,
      toAgentId: handoff.toAgentId,
      taskId: handoff.taskId,
      contextSummary: handoff.contextSummary,
      status: handoff.status,
    } : null,
    projectMemories: isResumeIntent ? [] : approvedMems,
    draftMemories: draftMems.map(m => ({
      id: m.id, category: m.category, title: m.title, content: m.content, status: m.status,
    })),
    taskList,
    agentList,
    prompt,
    suggestedNextActions,
    generatedAt: now(),
  };
}

/**
 * Enforce a prepared context — returns ready/warnings/missingSections.
 */
export function enforcePreparedContext(prepared: PreparedContext): {
  ready: boolean;
  warnings: string[];
  missingSections: ContextSection[];
} {
  return {
    ready: prepared.ready,
    warnings: prepared.warnings,
    missingSections: prepared.missingSections,
  };
}

/**
 * Get info about all available policies.
 */
export function getContextPolicyInfo(): ContextPolicyInfo {
  return {
    intents: listContextIntents(),
    roles: listContextRoles(),
    policies: Object.values(CONTEXT_POLICIES),
  };
}
