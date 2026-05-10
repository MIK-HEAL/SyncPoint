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
  return ctx.resumePrompt;
}

function formatReviewPrompt(
  task: { id: string; title: string; status: string } | null,
  capsule: ResumeContext["latestSnapshot"],
  checkpoint: ResumeContext["latestCheckpoint"],
  contract: ResumeContext["approvedContract"],
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
): string {
  const lines: string[] = [];
  lines.push("# Review Context");
  lines.push("");

  if (task) {
    lines.push(`**Task**: ${task.title} (${task.status}) [${task.id}]`);
    lines.push("");
  }

  if (contract) {
    lines.push("## Peer Contract");
    lines.push(`- **Scope**: ${contract.scope}`);
    lines.push(`- **Responsibilities**: ${contract.responsibilities}`);
    lines.push(`- **Interface**: ${contract.interfaceSpec}`);
    lines.push(`- **Resource Boundaries**: ${contract.fileBoundaries}`);
    lines.push("");
  }

  if (checkpoint) {
    lines.push("## Latest Checkpoint");
    lines.push(`- **Summary**: ${checkpoint.summary}`);
    lines.push(`- **Progress**: ${checkpoint.progress}`);
    if (checkpoint.risks) lines.push(`- **Risks**: ${checkpoint.risks}`);
    if (checkpoint.blockers) lines.push(`- **Blockers**: ${checkpoint.blockers}`);
    lines.push("");
  }

  if (capsule) {
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(capsule.payloadJson ?? "{}"); } catch { /* ok */ }
    lines.push("## Context Capsule");
    if (p.goal) lines.push(`- **Goal**: ${p.goal}`);
    if (p.currentPhase) lines.push(`- **Phase**: ${p.currentPhase}`);
    if (p.completedWork) lines.push(`- **Completed**: ${p.completedWork}`);
    if (p.remainingWork) lines.push(`- **Remaining**: ${p.remainingWork}`);
    if (Array.isArray(p.nextSteps) && p.nextSteps.length) lines.push(`- **Next Steps**: ${p.nextSteps.join(", ")}`);
    lines.push("");
  }

  if (projectMems.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of projectMems) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  }

  lines.push("## Review Checklist");
  lines.push("- [ ] Does the work match the contract scope?");
  lines.push("- [ ] Are there unresolved risks or blockers?");
  lines.push("- [ ] Is the checkpoint summary accurate?");
  lines.push("- [ ] Are remaining tasks clearly defined?");

  return lines.join("\n");
}

function formatArchitectPrompt(
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
  tasks: Array<{ id: string; title: string; status: string; ownerAgentId: string | null }>,
): string {
  const lines: string[] = [];
  lines.push("# Architect Planning Context");
  lines.push("");

  if (projectMems.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of projectMems) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  } else {
    lines.push("## Project Knowledge");
    lines.push("No approved project memories yet. Consider adding project overview, architecture, and key decisions.");
    lines.push("");
  }

  if (tasks.length > 0) {
    lines.push("## Current Tasks");
    for (const t of tasks) {
      const owner = t.ownerAgentId ? ` → ${t.ownerAgentId}` : "";
      lines.push(`- **${t.title}** — ${t.status}${owner} [${t.id}]`);
    }
    lines.push("");
  }

  lines.push("## Suggested Actions");
  lines.push("- Review and update project memory entries");
  lines.push("- Identify architectural decisions that need recording");
  lines.push("- Plan task breakdown and agent assignment");

  return lines.join("\n");
}

function formatHandoffReceivePrompt(
  task: { id: string; title: string; status: string } | null,
  agent: { id: string; name: string; role: string } | null,
  handoff: Handoff | null,
  senderCapsule: ContextSnapshot | null,
  receiverResume: ResumeContext | null,
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
): string {
  const lines: string[] = [];
  lines.push("# Handoff Receive Context");
  lines.push("");

  if (task) {
    lines.push(`**Task**: ${task.title} (${task.status}) [${task.id}]`);
  }
  if (agent) {
    lines.push(`**Receiving Agent**: ${agent.name} (${agent.role}) [${agent.id}]`);
  }
  lines.push("");

  if (handoff) {
    lines.push("## Handoff");
    lines.push(`- **From**: ${handoff.fromAgentId}`);
    lines.push(`- **To**: ${handoff.toAgentId}`);
    lines.push(`- **Status**: ${handoff.status}`);
    lines.push(`- **Context**: ${handoff.contextSummary}`);
    lines.push("");
  }

  if (senderCapsule) {
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(senderCapsule.payloadJson ?? "{}"); } catch { /* ok */ }
    lines.push("## Sender Context Capsule");
    if (p.goal) lines.push(`- **Goal**: ${p.goal}`);
    if (p.currentPhase) lines.push(`- **Phase**: ${p.currentPhase}`);
    if (p.completedWork) lines.push(`- **Completed**: ${p.completedWork}`);
    if (p.remainingWork) lines.push(`- **Remaining**: ${p.remainingWork}`);
    if (Array.isArray(p.nextSteps) && p.nextSteps.length) lines.push(`- **Next Steps**: ${p.nextSteps.join(", ")}`);
    if (Array.isArray(p.blockers) && p.blockers.length) lines.push(`- **Blockers**: ${p.blockers.join(", ")}`);
    if (p.resumePrompt) {
      lines.push("");
      lines.push("### Resume Note");
      lines.push(String(p.resumePrompt));
    }
    lines.push("");
  }

  if (receiverResume?.approvedContract) {
    lines.push("## Approved Contract");
    lines.push(`- **Scope**: ${receiverResume.approvedContract.scope}`);
    lines.push(`- **Responsibilities**: ${receiverResume.approvedContract.responsibilities}`);
    lines.push(`- **Interface**: ${receiverResume.approvedContract.interfaceSpec}`);
    lines.push("");
  }

  if (projectMems.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of projectMems) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  }

  lines.push("## Required Next Actions");
  lines.push("- Confirm you understand the handoff context.");
  lines.push("- Create your own checkpoint/capsule after making progress.");
  lines.push("- Ask for sync if contract boundaries or remaining work are unclear.");

  return lines.join("\n");
}

function formatOnboardPrompt(
  projectMems: Array<{ id: string; category: string; title: string; content: string }>,
  tasks: Array<{ id: string; title: string; status: string; ownerAgentId: string | null }>,
  agents: Array<{ id: string; name: string; role: string; status: string }>,
): string {
  const lines: string[] = [];
  lines.push("# Project Onboarding");
  lines.push("");

  if (projectMems.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of projectMems) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  } else {
    lines.push("No approved project memories yet.");
    lines.push("");
  }

  if (agents.length > 0) {
    lines.push("## Active Agents");
    for (const a of agents) {
      lines.push(`- **${a.name}** (${a.role}) — ${a.status} [${a.id}]`);
    }
    lines.push("");
  }

  if (tasks.length > 0) {
    lines.push("## Current Tasks");
    for (const t of tasks) {
      const owner = t.ownerAgentId ? ` → ${t.ownerAgentId}` : "";
      lines.push(`- **${t.title}** — ${t.status}${owner} [${t.id}]`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatMemoryReviewPrompt(
  approved: ProjectMemory[],
  drafts: ProjectMemory[],
  deprecated: ProjectMemory[],
): string {
  const lines: string[] = [];
  lines.push("# Project Memory Review");
  lines.push("");
  lines.push(`Total: ${approved.length + drafts.length + deprecated.length} memories (${drafts.length} draft, ${approved.length} approved, ${deprecated.length} deprecated)`);
  lines.push("");

  lines.push("## Draft (needs review)");
  lines.push("");
  if (drafts.length > 0) {
    for (const m of drafts) {
      lines.push(`### ${m.title} [${m.category}] — ${m.id}`);
      lines.push(`> Confidence: ${m.confidence} | Scope: ${m.scope}`);
      lines.push(m.content);
      lines.push("");
    }
  } else {
    lines.push("None.");
    lines.push("");
  }

  lines.push("## Approved (active in context)");
  lines.push("");
  if (approved.length > 0) {
    for (const m of approved) {
      lines.push(`### ${m.title} [${m.category}] — ${m.id}`);
      lines.push(m.content);
      lines.push("");
    }
  } else {
    lines.push("None.");
    lines.push("");
  }

  lines.push("## Deprecated");
  lines.push("");
  if (deprecated.length > 0) {
    for (const m of deprecated) {
      lines.push(`### ${m.title} [${m.category}] — ${m.id}`);
      lines.push(m.content);
      lines.push("");
    }
  } else {
    lines.push("None.");
    lines.push("");
  }

  lines.push("---");
  lines.push("Actions: syncpoint_project_memory_approve / syncpoint_project_memory_add / syncpoint_project_memory_export");

  return lines.join("\n");
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
  let senderCapsule: ContextSnapshot | null = null;

  // Task-scoped intents need task+agent
  const needsTask = allSections.some(s =>
    ["task", "latest-capsule", "latest-checkpoint", "approved-contract", "handoff-context"].includes(s)
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
          senderCapsule = repo.getLatestContextSnapshot(input.taskId, handoff.fromAgentId) ?? null;
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
      case "latest-capsule":
        present = input.intent === "handoff-receive"
          ? !!(resumeCtx?.latestSnapshot || senderCapsule || handoff?.contextSummary)
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
          (resumeCtx?.latestSnapshot?.payloadJson ? (() => { try { const p = JSON.parse(resumeCtx.latestSnapshot!.payloadJson); return Array.isArray(p.risks) && p.risks.length > 0; } catch { return false; } })() : false);
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
      prompt = formatHandoffReceivePrompt(taskInfo, agentInfo, handoff, senderCapsule, resumeCtx, []);
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
  if (missingSections.includes("latest-capsule")) {
    suggestedNextActions.push("Create a context capsule: syncpoint_loop_checkpoint or `syncpoint loop checkpoint`");
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
