import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loopStatus,
  loopResume,
  loopCheckpoint,
  loopHandoff,
} from "syncpoint-server/application";
import { getResumeContext } from "syncpoint-server/repositories";
import { formatResumePrompt } from "syncpoint-context";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerLoopContextTools(server: McpServer): void {
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
      description: "Resume a task — enforces context policy, generates adapter files and prompt. agentId is optional if connection is identity-bound. contextMode: snapshot-first (default), snapshot-only (no raw checkpoint/project memory), snapshot-locked (hard-block on any validation failure).",
      inputSchema: {
        agentId: z.string().optional(),
        taskId: z.string(),
        provider: z.string().optional(),
        format: z.enum(["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"]).optional(),
        contextMode: z.enum(["snapshot-first", "snapshot-only", "snapshot-locked"]).optional(),
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
      description: "Save a checkpoint and context snapshot for the current work session. agentId is optional if connection is identity-bound.",
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
}
