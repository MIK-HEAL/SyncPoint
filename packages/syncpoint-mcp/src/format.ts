/**
 * Markdown formatting helpers for MCP resource/tool output.
 */

import type { ContextSnapshotPayload, ProjectMemory } from "syncpoint-context";

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

function listText(value: string[] | string | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

export function formatContextSnapshotSummary(snapshot: {
  id: string;
  agentId: string;
  summary?: string;
  payload: ContextSnapshotPayload;
  createdAt: string;
}): string {
  const payload = snapshot.payload ?? {};
  const workingResources = listText(payload.workingResources);
  const nextSteps = listText(payload.nextSteps);
  const blockers = listText(payload.blockers);
  const goal = payload.goal || snapshot.summary || "";
  const lines = [
    `## Snapshot ${snapshot.id}`,
    "",
    `- **Agent**: ${snapshot.agentId}`,
    `- **Created**: ${snapshot.createdAt}`,
    `- **Goal**: ${goal || "(empty)"}`,
    `- **Phase**: ${payload.currentPhase || "(empty)"}`,
  ];
  if (workingResources) lines.push(`- **Resources**: ${workingResources}`);
  if (payload.completedWork) lines.push(`- **Completed**: ${payload.completedWork}`);
  if (payload.remainingWork) lines.push(`- **Remaining**: ${payload.remainingWork}`);
  if (nextSteps) lines.push(`- **Next**: ${nextSteps}`);
  if (blockers) lines.push(`- **Blockers**: ${blockers}`);
  return lines.join("\n");
}

export function formatProjectMemorySummary(m: ProjectMemory): string {
  return `### ${m.title}\n> Category: ${m.category} | Status: ${m.status} | Confidence: ${m.confidence}\n\n${m.content}`;
}

export function formatToolResult(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2);
}