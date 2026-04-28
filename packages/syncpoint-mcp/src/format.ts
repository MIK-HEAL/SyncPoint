/**
 * Markdown formatting helpers for MCP resource/tool output.
 */

import type { ProjectMemory } from "syncpoint-core";

export function formatAgentSummary(agent: { id: string; name: string; role: string; status: string }): string {
  return `- **${agent.name}** (${agent.role}) — ${agent.status} [${agent.id}]`;
}

export function formatTaskSummary(task: { id: string; title: string; status: string; ownerAgentId?: string | null }): string {
  const owner = task.ownerAgentId ? ` → ${task.ownerAgentId}` : "";
  return `- **${task.title}** — ${task.status}${owner} [${task.id}]`;
}

export function formatCheckpointSummary(cp: { id: string; summary: string; createdAt: string; needSync?: boolean }): string {
  const sync = cp.needSync ? " ⚠ NEEDS_SYNC" : "";
  return `- [${cp.createdAt}] ${cp.summary}${sync} [${cp.id}]`;
}

export function formatCapsuleSummary(capsule: {
  id: string;
  agentId: string;
  goal: string;
  currentPhase: string;
  workingFiles?: string;
  completedWork?: string;
  remainingWork?: string;
  nextSteps?: string;
  blockers?: string;
  createdAt: string;
}): string {
  const lines = [
    `## Capsule ${capsule.id}`,
    "",
    `- **Agent**: ${capsule.agentId}`,
    `- **Created**: ${capsule.createdAt}`,
    `- **Goal**: ${capsule.goal || "(empty)"}`,
    `- **Phase**: ${capsule.currentPhase || "(empty)"}`,
  ];
  if (capsule.workingFiles) lines.push(`- **Files**: ${capsule.workingFiles}`);
  if (capsule.completedWork) lines.push(`- **Completed**: ${capsule.completedWork}`);
  if (capsule.remainingWork) lines.push(`- **Remaining**: ${capsule.remainingWork}`);
  if (capsule.nextSteps) lines.push(`- **Next**: ${capsule.nextSteps}`);
  if (capsule.blockers) lines.push(`- **Blockers**: ${capsule.blockers}`);
  return lines.join("\n");
}

export function formatProjectMemorySummary(m: ProjectMemory): string {
  return `### ${m.title}\n> Category: ${m.category} | Status: ${m.status} | Confidence: ${m.confidence}\n\n${m.content}`;
}

export function formatToolResult(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}
