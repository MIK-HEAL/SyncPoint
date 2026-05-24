import type {
  ContextPolicy,
  ContextSnapshot,
  Handoff,
  ProjectMemory,
  ResumeContext,
} from "syncpoint-core";

export interface PromptTaskInfo {
  id: string;
  title: string;
  status: string;
}

export interface PromptTaskListItem {
  id: string;
  title: string;
  status: string;
  ownerAgentId: string | null;
}

export interface PromptAgentInfo {
  id: string;
  name: string;
  role: string;
}

export interface PromptAgentListItem {
  id: string;
  name: string;
  role: string;
  status: string;
}

export interface PromptProjectMemoryItem {
  id: string;
  category: string;
  title: string;
  content: string;
}

export function formatExecutePrompt(
  ctx: ResumeContext,
  _policy: ContextPolicy,
): string {
  return ctx.resumePrompt;
}

export function formatReviewPrompt(
  task: PromptTaskInfo | null,
  snapshot: ResumeContext["latestSnapshot"],
  checkpoint: ResumeContext["latestCheckpoint"],
  contract: ResumeContext["approvedContract"],
  projectMems: PromptProjectMemoryItem[],
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
    lines.push(`- **Responsibilities**: ${contract.responsibilities.join(", ")}`);
    lines.push(`- **Interface**: ${contract.interfaceSpec.join(", ")}`);
    lines.push(`- **Resource Boundaries**: ${contract.fileBoundaries.join(", ")}`);
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

  if (snapshot) {
    const p = snapshot.payload ?? {};
    lines.push("## Context Snapshot");
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

export function formatArchitectPrompt(
  projectMems: PromptProjectMemoryItem[],
  tasks: PromptTaskListItem[],
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

export function formatHandoffReceivePrompt(
  task: PromptTaskInfo | null,
  agent: PromptAgentInfo | null,
  handoff: Handoff | null,
  senderSnapshot: ContextSnapshot | null,
  receiverResume: ResumeContext | null,
  projectMems: PromptProjectMemoryItem[],
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

  if (senderSnapshot) {
    const p = senderSnapshot.payload ?? {};
    lines.push("## Sender Context Snapshot");
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
    lines.push(`- **Responsibilities**: ${receiverResume.approvedContract.responsibilities.join(", ")}`);
    lines.push(`- **Interface**: ${receiverResume.approvedContract.interfaceSpec.join(", ")}`);
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
  lines.push("- Create your own checkpoint/snapshot after making progress.");
  lines.push("- Ask for sync if contract boundaries or remaining work are unclear.");

  return lines.join("\n");
}

export function formatOnboardPrompt(
  projectMems: PromptProjectMemoryItem[],
  tasks: PromptTaskListItem[],
  agents: PromptAgentListItem[],
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

export function formatMemoryReviewPrompt(
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
