/**
 * MCP task-related prompts — executor, reviewer, architect, and planning.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prepareContext, orchGetSessionStatus } from "syncpoint-server/application";

export function registerTaskPrompts(server: McpServer): void {
  // ── syncpoint_executor_resume ──
  server.registerPrompt(
    "syncpoint_executor_resume",
    {
      title: "Executor Resume",
      description: "Resume an executor at a sync point with checkpoint context and gate enforcement.",
      argsSchema: { taskId: z.string().describe("Task ID"), agentId: z.string().describe("Agent ID") },
    },
    ({ taskId, agentId }) => {
      const prepared = prepareContext({ intent: "resume", role: "executor", taskId, agentId });
      let text = prepared.prompt;
      if (!prepared.ready) {
        text = [
          "⚠ Context not ready — missing:",
          ...prepared.missingSections.map(s => `- ${s}`), "",
          "Suggested actions:", ...prepared.suggestedNextActions.map(a => `- ${a}`),
          "", "---", "", text,
        ].join("\n");
      }
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );

  // ── syncpoint_reviewer_checklist ──
  server.registerPrompt(
    "syncpoint_reviewer_checklist",
    {
      title: "Reviewer Checklist",
      description: "Review sync gate — contract, checkpoint evidence, snapshot, and approval checklist.",
      argsSchema: { taskId: z.string().describe("Task ID"), agentId: z.string().describe("Agent ID") },
    },
    ({ taskId, agentId }) => {
      const prepared = prepareContext({ intent: "review", role: "reviewer", taskId, agentId });
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: prepared.prompt } }] };
    }
  );

  // ── syncpoint_architect_briefing ──
  server.registerPrompt(
    "syncpoint_architect_briefing",
    {
      title: "Architect Briefing",
      description: "Architect sync briefing — project memory, task boundaries, agent assignments, coordination.",
    },
    () => {
      const prepared = prepareContext({ intent: "architect-plan", role: "architect" });
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: prepared.prompt } }] };
    }
  );

  // ── syncpoint_architect_plan ──
  server.registerPrompt(
    "syncpoint_architect_plan",
    {
      title: "Architect Planning",
      description: "Architect plan with project memory, tasks, context policy, file boundaries, and blockers.",
      argsSchema: { sessionId: z.string().describe("Sync session ID") },
    },
    ({ sessionId }) => {
      const status = orchGetSessionStatus(sessionId);
      const prepared = prepareContext({ intent: "architect-plan", role: "architect" });
      const lines: string[] = [prepared.prompt, "", "## Current Session",
        `**Session**: ${status.session.title} [${status.session.status}]`];
      if (status.roles.length > 0) {
        lines.push("**Roles**: " + status.roles.map(r => `${r.agentId}=${r.role}`).join(", "));
      }
      if (status.assignments.length > 0) {
        lines.push("**Assignments**: " + status.assignments.map(a => `${a.taskId}→${a.assigneeAgentId}[${a.status}]`).join(", "));
      }
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    }
  );

  // ── syncpoint_review_task ──
  server.registerPrompt(
    "syncpoint_review_task",
    {
      title: "Review Task",
      description: "Reviewer prompt for a specific task with context policy, contract, checkpoint, and snapshot.",
      argsSchema: { taskId: z.string().describe("Task ID"), agentId: z.string().describe("Reviewer agent ID") },
    },
    ({ taskId, agentId }) => {
      const prepared = prepareContext({ intent: "review", role: "reviewer", taskId, agentId });
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: prepared.prompt } }] };
    }
  );
}
