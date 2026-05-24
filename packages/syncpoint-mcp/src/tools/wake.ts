import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  wakeList,
  wakeNext,
  wakeAck,
  wakeStart,
  wakeDone,
  wakeFail,
  wakeSkip,
  wakeEngineStats,
} from "syncpoint-server/application";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerWakeTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════
  // Wake Engine Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_wake_list",
    {
      title: "Wake List",
      description: "List wake requests. Filter by session, agent, or status.",
      inputSchema: {
        sessionId: z.string().optional(),
        agentId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ wakeRequests: wakeList(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_next",
    {
      title: "Wake Next",
      description: "Get the next queued wake request for an agent. Returns the action the agent should perform next. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
      },
    },
    async ({ agentId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const wake = wakeNext(resolved);
        if (!wake) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ hasWake: false, message: "No pending wake requests." }) }] };
        }
        return ok({ hasWake: true, ...wake });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_ack",
    {
      title: "Wake Acknowledge",
      description: "Acknowledge a wake request — marks it as dispatched.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try { return ok(wakeAck(id)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_start",
    {
      title: "Wake Start",
      description: "Mark a wake request as running — the agent has started executing the action.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try { return ok(wakeStart(id)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_done",
    {
      title: "Wake Done",
      description: "Mark a wake request as done — the agent has completed the action.",
      inputSchema: {
        id: z.string(),
        resultSummary: z.string().optional(),
      },
    },
    async ({ id, resultSummary }) => {
      try { return ok(wakeDone(id, resultSummary)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_fail",
    {
      title: "Wake Fail",
      description: "Mark a wake request as failed.",
      inputSchema: {
        id: z.string(),
        resultSummary: z.string().optional(),
      },
    },
    async ({ id, resultSummary }) => {
      try { return ok(wakeFail(id, resultSummary)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_skip",
    {
      title: "Wake Skip",
      description: "Skip a wake request — marks it as skipped (not applicable).",
      inputSchema: {
        id: z.string(),
        resultSummary: z.string().optional(),
      },
    },
    async ({ id, resultSummary }) => {
      try { return ok(wakeSkip(id, resultSummary)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_wake_stats",
    {
      title: "Wake Engine Stats",
      description: "Get wake engine statistics — events processed, wake requests created, etc.",
    },
    async () => {
      try { return ok(wakeEngineStats()); }
      catch (e) { return fail(e); }
    }
  );
}
