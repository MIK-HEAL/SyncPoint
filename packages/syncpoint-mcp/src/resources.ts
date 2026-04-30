/**
 * MCP resources — read-only data exposed to LLM clients.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatResumePrompt } from "syncpoint-core";
import * as repo from "syncpoint-server/repositories";
import { pmList, pmExport, getContextPolicyInfo, prepareContext, orchGetSessionStatus, rwListEvidence, rwListChangeRequests, rwPrepareReviewPacket, pbGetActiveSession, pbGetNextAction } from "syncpoint-server/application";
import { ContextIntent, ContextRole } from "syncpoint-core";
import {
  formatAgentSummary,
  formatTaskSummary,
  formatCheckpointSummary,
  formatCapsuleSummary,
  formatProjectMemorySummary,
} from "./format.js";

export function registerResources(server: McpServer): void {
  // ── syncpoint://status ──
  server.registerResource(
    "syncpoint-status",
    "syncpoint://status",
    { title: "SyncPoint Status", description: "Overview of agents and tasks", mimeType: "text/plain" },
    async (uri) => {
      const agents = repo.listAgents();
      const tasks = repo.listTasks();
      const lines = [
        "# SyncPoint Status",
        "",
        `## Agents (${agents.length})`,
        ...agents.map(formatAgentSummary),
        "",
        `## Tasks (${tasks.length})`,
        ...tasks.map(formatTaskSummary),
      ];
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  // ── syncpoint://agents ──
  server.registerResource(
    "syncpoint-agents",
    "syncpoint://agents",
    { title: "All Agents", description: "List all registered agents", mimeType: "text/plain" },
    async (uri) => {
      const agents = repo.listAgents();
      const lines = ["# Agents", "", ...agents.map(formatAgentSummary)];
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  // ── syncpoint://tasks ──
  server.registerResource(
    "syncpoint-tasks",
    "syncpoint://tasks",
    { title: "All Tasks", description: "List all tasks", mimeType: "text/plain" },
    async (uri) => {
      const tasks = repo.listTasks();
      const lines = ["# Tasks", "", ...tasks.map(formatTaskSummary)];
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  // ── syncpoint://task/{taskId} ──
  server.registerResource(
    "syncpoint-task",
    new ResourceTemplate("syncpoint://task/{taskId}", { list: undefined }),
    { title: "Task Detail", description: "Full detail for a specific task", mimeType: "text/plain" },
    async (uri, { taskId }) => {
      const task = repo.getTask(taskId as string);
      const checkpoints = repo.listCheckpoints(task.id);
      const lines = [
        `# Task: ${task.title}`,
        "",
        `- **ID**: ${task.id}`,
        `- **Status**: ${task.status}`,
        `- **Owner**: ${task.ownerAgentId ?? "unassigned"}`,
        `- **Description**: ${task.description}`,
        "",
        `## Checkpoints (${checkpoints.length})`,
        ...checkpoints.map(formatCheckpointSummary),
      ];
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  // ── syncpoint://task/{taskId}/checkpoints ──
  server.registerResource(
    "syncpoint-task-checkpoints",
    new ResourceTemplate("syncpoint://task/{taskId}/checkpoints", { list: undefined }),
    { title: "Task Checkpoints", description: "Checkpoints for a task", mimeType: "text/plain" },
    async (uri, { taskId }) => {
      const checkpoints = repo.listCheckpoints(taskId as string);
      const lines = ["# Checkpoints", "", ...checkpoints.map(formatCheckpointSummary)];
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  // ── syncpoint://task/{taskId}/capsules ──
  server.registerResource(
    "syncpoint-task-capsules",
    new ResourceTemplate("syncpoint://task/{taskId}/capsules", { list: undefined }),
    { title: "Task Capsules", description: "Context capsules for a task", mimeType: "text/plain" },
    async (uri, { taskId }) => {
      const capsules = repo.listCapsules(taskId as string);
      const lines = [
        "# Context Capsules",
        "",
        ...(capsules.length > 0 ? capsules.map(formatCapsuleSummary) : ["No context capsules."]),
      ];
      return { contents: [{ uri: uri.href, text: lines.join("\n\n") }] };
    }
  );

  // ── syncpoint://task/{taskId}/resume-context/{agentId} ──
  server.registerResource(
    "syncpoint-resume-context",
    new ResourceTemplate("syncpoint://task/{taskId}/resume-context/{agentId}", { list: undefined }),
    { title: "Resume Context", description: "Full resume context for a task+agent pair", mimeType: "text/plain" },
    async (uri, { taskId, agentId }) => {
      const ctx = repo.getResumeContext(taskId as string, agentId as string);
      const prompt = formatResumePrompt(ctx, "system-prompt");
      return { contents: [{ uri: uri.href, text: prompt }] };
    }
  );

  // ── syncpoint://project-memory ──
  server.registerResource(
    "syncpoint-project-memory",
    "syncpoint://project-memory",
    { title: "Project Memory", description: "All approved project memories", mimeType: "text/plain" },
    async (uri) => {
      const mems = pmList({ status: "approved" });
      if (mems.length === 0) {
        return { contents: [{ uri: uri.href, text: "# Project Memory\n\nNo approved project memories." }] };
      }
      const lines = ["# Project Memory", "", ...mems.map(formatProjectMemorySummary)];
      return { contents: [{ uri: uri.href, text: lines.join("\n\n") }] };
    }
  );

  // ── syncpoint://project-memory/{category} ──
  server.registerResource(
    "syncpoint-project-memory-category",
    new ResourceTemplate("syncpoint://project-memory/{category}", { list: undefined }),
    { title: "Project Memory by Category", description: "Approved memories filtered by category", mimeType: "text/plain" },
    async (uri, { category }) => {
      const mems = pmList({ status: "approved", category: category as string });
      if (mems.length === 0) {
        return { contents: [{ uri: uri.href, text: `# Project Memory: ${category}\n\nNo entries.` }] };
      }
      const lines = [`# Project Memory: ${category}`, "", ...mems.map(formatProjectMemorySummary)];
      return { contents: [{ uri: uri.href, text: lines.join("\n\n") }] };
    }
  );

  // ── syncpoint://context/policy ──
  server.registerResource(
    "syncpoint-context-policy",
    "syncpoint://context/policy",
    { title: "Context Policies", description: "All supported context intents, roles, and gate policies", mimeType: "text/plain" },
    async (uri) => {
      const info = getContextPolicyInfo();
      const lines = [
        "# Context Policies",
        "",
        `Intents: ${info.intents.join(", ")}`,
        `Roles: ${info.roles.join(", ")}`,
        "",
      ];
      for (const p of info.policies) {
        lines.push(`## ${p.intent} [${p.gateMode.toUpperCase()}]`);
        lines.push(p.description);
        if (p.requiredSections.length) lines.push(`Required: ${p.requiredSections.join(", ")}`);
        if (p.includeSections.length) lines.push(`Includes: ${p.includeSections.join(", ")}`);
        lines.push("");
      }
      return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
    }
  );

  // ── syncpoint://context/prepare/{intent}/{role} ──
  server.registerResource(
    "syncpoint-context-prepare",
    new ResourceTemplate("syncpoint://context/prepare/{intent}/{role}", { list: undefined }),
    { title: "Prepared Context", description: "Prepare context for a given intent and role (read-only preview)", mimeType: "text/plain" },
    async (uri, { intent, role }) => {
      const prepared = prepareContext({
        intent: intent as ContextIntent,
        role: role as ContextRole,
      });
      return { contents: [{ uri: uri.href, text: prepared.prompt }] };
    }
  );

  // ── syncpoint://session/{sessionId} ──
  server.registerResource(
    "syncpoint-session",
    new ResourceTemplate("syncpoint://session/{sessionId}", { list: undefined }),
    { title: "Sync Session", description: "Full synchronization session status with roles, assignments, reviews, decisions, and blocker context", mimeType: "text/plain" },
    async (uri, { sessionId }) => {
      try {
        const status = orchGetSessionStatus(sessionId as string);
        const lines: string[] = [];
        lines.push(`# Session: ${status.session.title}`);
        lines.push(`Status: ${status.session.status}`);
        lines.push("");
        lines.push("## Roles");
        for (const r of status.roles) lines.push(`- ${r.agentId}: ${r.role}`);
        lines.push("");
        lines.push("## Assignments");
        for (const a of status.assignments) lines.push(`- ${a.taskId} → ${a.assigneeAgentId} [${a.status}]`);
        lines.push("");
        lines.push("## Reviews");
        for (const r of status.reviews) lines.push(`- ${r.taskId} by ${r.reviewerAgentId} [${r.status}]`);
        lines.push("");
        lines.push("## Decisions");
        for (const d of status.decisions) lines.push(`- ${d.reviewRequestId}: ${d.verdict} — ${d.summary}`);
        return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
      } catch {
        return { contents: [{ uri: uri.href, text: "Session not found." }] };
      }
    }
  );

  // ── syncpoint://review/{reviewRequestId}/packet ──
  server.registerResource(
    "syncpoint-review-packet",
    new ResourceTemplate("syncpoint://review/{reviewRequestId}/packet", { list: undefined }),
    { title: "Review Packet", description: "Full review packet with checklist, evidence, changes, gate", mimeType: "text/plain" },
    async (uri, { reviewRequestId }) => {
      try {
        const packet = rwPrepareReviewPacket(reviewRequestId as string);
        const lines: string[] = [];
        lines.push(`# Review Packet: ${packet.reviewRequest.id}`);
        lines.push(`Gate: ${packet.gate.status}`);
        lines.push("");
        lines.push("## Checklist");
        for (const i of packet.checklistItems) lines.push(`- [${i.status}] ${i.title}${i.required ? " (required)" : ""}`);
        lines.push("");
        lines.push("## Evidence");
        for (const e of packet.evidence) lines.push(`- [${e.kind}] ${e.title}`);
        lines.push("");
        lines.push("## Change Requests");
        for (const c of packet.changeRequests) lines.push(`- [${c.status}] ${c.summary}`);
        lines.push("");
        lines.push("## Approval Records");
        for (const a of packet.approvalRecords) lines.push(`- ${a.decision}: ${a.summary}`);
        return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
      } catch {
        return { contents: [{ uri: uri.href, text: "Review not found." }] };
      }
    }
  );

  // ── syncpoint://active-session/{agentId} ──
  server.registerResource(
    "syncpoint-active-session",
    new ResourceTemplate("syncpoint://active-session/{agentId}", { list: undefined }),
    { title: "Active Session", description: "Active session details and next actions for an agent", mimeType: "text/plain" },
    async (uri, { agentId }) => {
      try {
        const result = pbGetActiveSession(agentId as string);
        if (!result) {
          return { contents: [{ uri: uri.href, text: "No active session for this agent." }] };
        }
        const lines: string[] = [];
        lines.push(`# Active Session: ${result.sessionId}`);
        lines.push(`Status: ${result.sessionStatus}`);
        lines.push(`Agent: ${result.agentName} (${result.agentId})`);
        lines.push(`Roles: ${result.roles.join(", ")}`);
        lines.push(`Assignments: ${result.assignmentCount}  Reviews: ${result.reviewCount}`);
        lines.push("");
        lines.push("## Next Actions");
        for (const a of result.actions) {
          lines.push(`- [P${a.priority}] **${a.action}**: ${a.reason}`);
          if (a.mcpToolHint) lines.push(`  Tool: ${a.mcpToolHint}`);
        }
        return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
      } catch {
        return { contents: [{ uri: uri.href, text: "Agent not found." }] };
      }
    }
  );

  // ── syncpoint://session/{sessionId}/next-action/{agentId} ──
  server.registerResource(
    "syncpoint-next-action",
    new ResourceTemplate("syncpoint://session/{sessionId}/next-action/{agentId}", { list: undefined }),
    { title: "Next Action", description: "Recommended next actions for an agent in a session", mimeType: "text/plain" },
    async (uri, { sessionId, agentId }) => {
      try {
        const result = pbGetNextAction({ sessionId: sessionId as string, agentId: agentId as string });
        const lines: string[] = [];
        lines.push(`# Next Actions: ${result.sessionId} [${result.sessionStatus}]`);
        lines.push(`Agent: ${result.agentId}`);
        lines.push("");
        for (const a of result.actions) {
          lines.push(`## [P${a.priority}] ${a.action}`);
          lines.push(a.reason);
          if (a.cliHint) lines.push(`CLI: ${a.cliHint}`);
          if (a.mcpToolHint) lines.push(`MCP: ${a.mcpToolHint}`);
          lines.push("");
        }
        return { contents: [{ uri: uri.href, text: lines.join("\n") }] };
      } catch {
        return { contents: [{ uri: uri.href, text: "Session or agent not found." }] };
      }
    }
  );
}
