import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  stxCreate,
  stxApprove,
  stxReject,
  stxResolve,
  stxStatus,
} from "syncpoint-server/application";
import { fail, ok } from "./_shared.js";

export function registerCheckpointReviewTools(server: McpServer): void {
  // CheckpointReview Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_checkpoint_review_create",
    {
      title: "Create Checkpoint Review",
      description: "Create a checkpoint review for a checkpoint. Automatically creates a bound SyncGate. The requesting agent is blocked until all approvers approve and the review is resolved.",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        checkpointId: z.string(),
        requestingAgentId: z.string(),
        requiredApproverIds: z.array(z.string()).min(1).describe("Agent IDs that must approve"),
      },
    },
    async (input) => {
      try {
        const result = stxCreate(input);
        return ok({
          tx: result.tx,
          pending: result.pending,
          isBlocking: result.isBlocking,
          gateId: result.tx.gateId,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_checkpoint_review_status",
    {
      title: "Checkpoint Review Status",
      description: "Get detailed status of a checkpoint review — pending approvers, approval/rejection state, blocking state.",
      inputSchema: { txId: z.string() },
    },
    async ({ txId }) => {
      try {
        const result = stxStatus(txId);
        return ok({
          tx: result.tx,
          pending: result.pending,
          allApproved: result.allApproved,
          hasRejection: result.hasRejection,
          isBlocking: result.isBlocking,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_checkpoint_review_approve",
    {
      title: "Approve Checkpoint Review",
      description: "Approve a checkpoint review as a required approver. When all approvers approve, the review advances to APPROVED.",
      inputSchema: {
        txId: z.string(),
        agentId: z.string(),
        summary: z.string().optional().describe("Approval summary"),
      },
    },
    async ({ txId, agentId, summary }) => {
      try {
        const result = stxApprove(txId, agentId, summary);
        return ok({
          tx: result.tx,
          pending: result.pending,
          allApproved: result.allApproved,
        });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_checkpoint_review_reject",
    {
      title: "Reject Checkpoint Review",
      description: "Reject a checkpoint review. The requesting agent remains blocked. A follow-up action is required before the review can be resolved.",
      inputSchema: {
        txId: z.string(),
        agentId: z.string(),
        reason: z.string().optional().describe("Rejection reason"),
      },
    },
    async ({ txId, agentId, reason }) => {
      try {
        const result = stxReject(txId, agentId, reason);
        return ok({ tx: result.tx });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_checkpoint_review_resolve",
    {
      title: "Resolve Checkpoint Review",
      description: "Resolve a checkpoint review and release the bound SyncGate. The requesting agent may now resume work.",
      inputSchema: {
        txId: z.string(),
        decisionSummary: z.string().optional(),
      },
    },
    async ({ txId, decisionSummary }) => {
      try {
        const result = stxResolve(txId, decisionSummary);
        return ok({ tx: result.tx });
      } catch (e) { return fail(e); }
    }
  );
}
