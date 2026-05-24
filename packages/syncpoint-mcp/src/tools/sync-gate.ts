import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  sgRequest,
  sgAck,
  sgResolve,
  sgCancel,
  sgStatusDetailed,
  sgList,
  sgCheckAgent,
  sgVote,
} from "syncpoint-server/application";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerSyncGateTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════
  // SyncGate Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_sync_request",
    {
      title: "Request Sync Gate",
      description: "Create a synchronization barrier. All required agents must acknowledge before work can continue. Use when a resource conflict is detected, a phase transition needs coordination, or manual sync is needed.",
      inputSchema: {
        taskId: z.string(),
        requestedByAgentId: z.string(),
        requiredAgentIds: z.array(z.string()).min(1).describe("Agent IDs that must acknowledge"),
        sessionId: z.string().optional(),
        reason: z.enum(["resource_conflict", "phase_transition", "manual_request", "checkpoint_required", "context_drift"]).optional(),
        description: z.string().optional(),
        relatedFiles: z.array(z.string()).optional(),
        relatedResources: z.array(z.object({
          type: z.string(),
          locator: z.string(),
          metadata: z.string().optional().default(""),
        })).optional(),
        relatedCheckpointId: z.string().optional(),
        relatedClaimIds: z.array(z.string()).optional(),
      },
    },
    async (input) => {
      try {
        const result = sgRequest(input);
        return ok({
          gate: result.gate,
          pending: result.pending,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_ack",
    {
      title: "Acknowledge Sync Gate",
      description: "Acknowledge a sync gate as a required agent. Once all required agents acknowledge, the gate can be resolved. agentId is optional if connection is identity-bound.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string().optional(),
        summary: z.string().optional().describe("Optional summary of what was confirmed"),
      },
    },
    async ({ gateId, agentId, summary }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const result = sgAck(gateId, resolved, summary);
        return ok({
          gate: result.gate,
          pending: result.pending,
          allAcknowledged: result.allAcknowledged,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_resolve",
    {
      title: "Resolve Sync Gate",
      description: "Resolve a sync gate after all agents have acknowledged. Agents may now continue.",
      inputSchema: {
        gateId: z.string(),
        decisionSummary: z.string().optional(),
      },
    },
    async ({ gateId, decisionSummary }) => {
      try {
        const result = sgResolve(gateId, decisionSummary);
        return ok({ gate: result.gate });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_cancel",
    {
      title: "Cancel Sync Gate",
      description: "Cancel a sync gate that is no longer needed.",
      inputSchema: {
        gateId: z.string(),
        reason: z.string().optional(),
      },
    },
    async ({ gateId, reason }) => {
      try { return ok(sgCancel(gateId, reason)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_status",
    {
      title: "Sync Gate Status",
      description: "Get full detailed status of a sync gate — policy, votes, pending/acked agents, eligible voters, deadline, liveness preview, and available actions for a specific agent.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string().optional().describe("If provided, includes available actions for this agent"),
      },
    },
    async ({ gateId, agentId }) => {
      try {
        const detail = sgStatusDetailed(gateId, agentId);
        return ok(detail);
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_vote",
    {
      title: "Cast Sync Gate Vote",
      description: "Cast or change a vote on a sync gate. Only eligible voters (required agents, owner, escalation agents) may vote. Vote kinds: approve, reject, abstain, escalate.",
      inputSchema: {
        gateId: z.string(),
        agentId: z.string(),
        vote: z.enum(["approve", "reject", "abstain", "escalate"]),
        summary: z.string().optional().default(""),
      },
    },
    async ({ gateId, agentId, vote, summary }) => {
      try {
        const result = sgVote(gateId, agentId, vote, summary);
        return ok({
          gate: result.gate,
          pending: result.pending,
          isBlocking: result.isBlocking,
          message: `Vote '${vote}' cast by ${agentId} on gate ${gateId}. Gate status: ${result.gate.status}.`,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_list",
    {
      title: "List Sync Gates",
      description: "List sync gates. Filter by task, session, or status.",
      inputSchema: {
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ gates: sgList(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_sync_check_agent",
    {
      title: "Check Agent Sync Block",
      description: "Check if an agent is blocked by any active sync gate. Call this before starting work, resuming, or executing a wake request.",
      inputSchema: {
        agentId: z.string(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async ({ agentId, taskId, sessionId }) => {
      try {
        const result = sgCheckAgent(agentId, { taskId, sessionId });
        if (result.blocked) {
          return ok({
            blocked: true,
            message: `Agent is blocked by ${result.blockingGates.length} sync gate(s). Acknowledge or wait for resolution before continuing.`,
            gates: result.blockingGates.map(g => ({
              id: g.id,
              reason: g.reason,
              description: g.description,
              pending: g.requiredAgentIds,
            })),
          });
        }
        return ok({ blocked: false, message: "Agent is not blocked by any sync gate." });
      } catch (e) { return fail(e); }
    }
  );
}
