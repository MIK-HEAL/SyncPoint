import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  prepareContext,
  getContextPolicyInfo,
} from "syncpoint-server/application";
import {
  ContextIntent,
  ContextRole,
} from "syncpoint-core";
import { fail, ok } from "./_shared.js";

export function registerContextTools(server: McpServer): void {
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
      description: "Prepare reviewer context for a task — includes contract, checkpoint, snapshot, and review checklist",
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
}
