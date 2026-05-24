import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRuntime,
  getRuntime,
  listRuntimes,
  updateRuntimeAgent,
  updateAgentRuntime,
  getAgent,
} from "syncpoint-server/repositories";
import { RuntimeKind } from "syncpoint-core";
import { getConnectionIdentity, isBound } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerRuntimeTools(server: McpServer): void {
  // ══════════════════════════════════════════════════════════
  // ── Runtime Identity (P11) ───────────────────────────────
  // ══════════════════════════════════════════════════════════

  // ── syncpoint_whoami ──
  server.registerTool(
    "syncpoint_whoami",
    {
      title: "Who Am I",
      description:
        "Returns the identity of this MCP connection: bound agentId, runtimeId, provider, and workspace. " +
        "Use this to confirm which agent this connection is speaking as.",
      inputSchema: {},
    },
    async () => {
      try {
        const identity = getConnectionIdentity();
        const envAgent = process.env.SYNCPOINT_AGENT_ID ?? null;
        const envRuntime = process.env.SYNCPOINT_RUNTIME_ID ?? null;
        const workspaceRoot = process.env.SYNCPOINT_PROJECT_ROOT ?? process.cwd();

        let agent = null;
        if (identity?.agentId) {
          try { agent = getAgent(identity.agentId); } catch { }
        }

        return ok({
          bound: isBound(),
          agentId: identity?.agentId ?? null,
          agentName: agent?.name ?? null,
          provider: agent?.provider ?? null,
          role: agent?.role ?? null,
          runtimeId: envRuntime,
          source: identity?.source ?? "none",
          workspaceRoot,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_register ──
  server.registerTool(
    "syncpoint_runtime_register",
    {
      title: "Register Runtime",
      description:
        "Register a new runtime instance. A runtime represents a physical editor window or daemon " +
        "that connects to SyncPoint. Optionally bind it to an agent.",
      inputSchema: {
        name: z.string().describe("Human-readable runtime name, e.g. 'architect-window'"),
        kind: z.enum(["local-mcp", "daemon", "cloud"]).optional().describe("Runtime kind"),
        provider: z.string().optional().describe("Editor/AI provider (copilot, cursor, codex, etc.)"),
        host: z.string().optional().describe("Machine/workstation name"),
        workspaceRoot: z.string().optional().describe("Workspace root path"),
        agentId: z.string().optional().describe("Agent to bind to this runtime"),
      },
    },
    async (input) => {
      try {
        if (input.agentId) {
          getAgent(input.agentId);
        }
        const rt = createRuntime({
          name: input.name,
          kind: (input.kind as any) ?? RuntimeKind.LOCAL_MCP,
          provider: input.provider ?? "",
          host: input.host ?? "",
          workspaceRoot: input.workspaceRoot ?? "",
          agentId: input.agentId ?? null,
        });
        if (input.agentId) {
          updateAgentRuntime(input.agentId, rt.id);
        }
        return ok({ runtime: rt, hint: `Set SYNCPOINT_RUNTIME_ID=${rt.id} in your MCP config.` });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_bind ──
  server.registerTool(
    "syncpoint_runtime_bind",
    {
      title: "Bind Agent to Runtime",
      description: "Bind an agent to a runtime. Future connections with that runtime ID will automatically act as this agent.",
      inputSchema: {
        runtimeId: z.string().describe("Runtime ID to bind"),
        agentId: z.string().describe("Agent ID to bind to the runtime"),
      },
    },
    async ({ runtimeId, agentId }) => {
      try {
        getAgent(agentId);
        const rt = updateRuntimeAgent(runtimeId, agentId);
        updateAgentRuntime(agentId, runtimeId);
        return ok({ runtime: rt });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_list ──
  server.registerTool(
    "syncpoint_runtime_list",
    {
      title: "List Runtimes",
      description: "List all registered runtime instances.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({ runtimes: listRuntimes() });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_runtime_status ──
  server.registerTool(
    "syncpoint_runtime_status",
    {
      title: "Runtime Status",
      description: "Get details of a specific runtime instance.",
      inputSchema: {
        runtimeId: z.string().describe("Runtime ID"),
      },
    },
    async ({ runtimeId }) => {
      try {
        const rt = getRuntime(runtimeId);
        let agent = null;
        if (rt.agentId) {
          try { agent = getAgent(rt.agentId); } catch { }
        }
        return ok({ runtime: rt, boundAgent: agent });
      } catch (e) { return fail(e); }
    }
  );
}
