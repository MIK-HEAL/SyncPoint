import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  pbGetNextAction,
  pbCaptureEvidence,
  pbGetActiveSession,
} from "syncpoint-server/application";
import { EvidenceKind } from "syncpoint-core";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerPlaybookTools(server: McpServer): void {
  // ── Playbook Tools ───────────────────────────────

  server.registerTool(
    "syncpoint_next_action",
    {
      title: "Next Action",
      description: "Get the next recommended action for an agent in a session. agentId is optional if connection is identity-bound.",
      inputSchema: {
        sessionId: z.string(),
        agentId: z.string().optional(),
      },
    },
    async ({ sessionId, agentId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        return ok(pbGetNextAction({ sessionId, agentId: resolved }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_capture_evidence",
    {
      title: "Capture Evidence",
      description: "Record command output (build/test/lint) as review evidence",
      inputSchema: {
        reviewRequestId: z.string(),
        command: z.string(),
        output: z.string(),
        exitCode: z.number().optional(),
        kind: EvidenceKind.optional(),
      },
    },
    async ({ reviewRequestId, command, output, exitCode, kind }) => {
      try {
        return ok(pbCaptureEvidence({ reviewRequestId, command, output, exitCode, kind }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_active_session",
    {
      title: "Active Session",
      description: "Find the active session for an agent and return next actions. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
      },
    },
    async ({ agentId }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const result = pbGetActiveSession(resolved);
        if (!result) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ active: false }) }] };
        }
        return ok(result);
      } catch (e) { return fail(e); }
    }
  );
}
