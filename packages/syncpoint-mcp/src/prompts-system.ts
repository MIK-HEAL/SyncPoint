/**
 * MCP system-level prompts — resume, checkpoint, handoff, project onboarding.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatResumePrompt } from "syncpoint-context";
import { getResumeContext } from "syncpoint-server/repositories";
import { pmList } from "syncpoint-server/application";
import { formatProjectMemorySummary } from "./format.js";

export function registerSystemPrompts(server: McpServer): void {
  // ── syncpoint_resume ──
  server.registerPrompt(
    "syncpoint_resume",
    {
      title: "Resume Task",
      description: "Generate a synchronization-aware resume prompt for an agent.",
      argsSchema: { taskId: z.string().describe("Task ID"), agentId: z.string().describe("Agent ID") },
    },
    ({ taskId, agentId }) => {
      const ctx = getResumeContext(taskId, agentId);
      ctx.projectMemories = [];
      const prompt = formatResumePrompt(ctx, "system-prompt");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt } }] };
    }
  );

  // ── syncpoint_checkpoint ──
  server.registerPrompt(
    "syncpoint_checkpoint",
    {
      title: "Checkpoint Guide",
      description: "Guide an agent to produce a structured checkpoint.",
      argsSchema: { taskId: z.string().describe("Task ID"), agentId: z.string().describe("Agent ID") },
    },
    ({ taskId, agentId }) => {
      const ctx = getResumeContext(taskId, agentId);
      const text = [
        "You are about to save a checkpoint for SyncPoint:",
        "", `**Task**: ${ctx.task.title} (${ctx.task.status})`, `**Agent**: ${ctx.agent.name}`, "",
        "Required: summary, progress, nextSteps", "Optional: risks, blockers, goal, phase, completed, remaining, workingResources, needSync",
        "", "Once ready, call `syncpoint_loop_checkpoint`.",
      ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );

  // ── syncpoint_handoff ──
  server.registerPrompt(
    "syncpoint_handoff",
    {
      title: "Handoff Guide",
      description: "Guide an agent to produce a structured handoff.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        fromAgentId: z.string().describe("Sending agent ID"),
        toAgentId: z.string().describe("Receiving agent ID"),
      },
    },
    ({ taskId, fromAgentId, toAgentId }) => {
      const ctx = getResumeContext(taskId, fromAgentId);
      const text = [
        `Handoff for **${ctx.task.title}**`, "",
        `From: ${fromAgentId}`, `To: ${toAgentId}`, "",
        "Provide context: 1) Completed work, 2) Current state & decisions, 3) Next steps, 4) Risks/blockers.",
        "", "Once ready, call `syncpoint_loop_handoff`.",
      ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );

  // ── syncpoint_project_onboarding ──
  server.registerPrompt(
    "syncpoint_project_onboarding",
    {
      title: "Project Onboarding",
      description: "Onboard a new agent with approved project memories and sync obligations.",
      argsSchema: { taskId: z.string().describe("Task ID").optional(), agentId: z.string().describe("Agent ID").optional() },
    },
    ({ taskId, agentId }) => {
      const mems = pmList({ status: "approved" });
      const memSection = mems.length > 0
        ? mems.map(formatProjectMemorySummary).join("\n\n")
        : "No approved project memories yet.";

      let taskSection = "";
      if (taskId && agentId) {
        try {
          const ctx = getResumeContext(taskId, agentId);
          ctx.projectMemories = [];
          taskSection = ["", "---", "", "## Current Task Context", "", formatResumePrompt(ctx, "system-prompt")].join("\n");
        } catch { /* skip */ }
      }

      const text = [
        "# Project Onboarding", "",
        "Curated project knowledge and synchronization context:",
        "", "## Project Memory", "", memSection, taskSection,
      ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );
}
