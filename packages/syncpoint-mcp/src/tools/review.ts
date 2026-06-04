import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  rwCreateChecklistItem,
  rwUpdateChecklistItem,
  rwAddEvidence,
  rwListEvidence,
  rwRequestChanges,
  rwAddressChange,
  rwEvaluateGate,
  rwApproveReview,
  rwBlockReview,
  rwPrepareReviewPacket,
} from "syncpoint-server/application";
import { EvidenceKind } from "syncpoint-governance";
import type { ChecklistItemStatus } from "syncpoint-governance";
import { fail, ok } from "./_shared.js";

export function registerReviewTools(server: McpServer): void {
  // ── Review Workflow Tools ────────────────────────────

  server.registerTool(
    "syncpoint_review_checklist_add",
    {
      title: "Add Checklist Item",
      description: "Add a checklist item to a review request",
      inputSchema: {
        reviewRequestId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
      },
    },
    async ({ reviewRequestId, title, description, required }) => {
      try {
        return ok(rwCreateChecklistItem({ reviewRequestId, title, description, required }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_checklist_update",
    {
      title: "Update Checklist Item",
      description: "Update a checklist item status (PASSED, FAILED, WAIVED, OPEN)",
      inputSchema: {
        itemId: z.string(),
        status: z.enum(["OPEN", "PASSED", "FAILED", "WAIVED"]),
        notes: z.string().optional(),
      },
    },
    async ({ itemId, status, notes }) => {
      try {
        return ok(rwUpdateChecklistItem(itemId, status as ChecklistItemStatus, { notes }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_evidence_add",
    {
      title: "Add Review Evidence",
      description: "Record evidence (build, test, typecheck, manual, etc.) for a review",
      inputSchema: {
        reviewRequestId: z.string(),
        kind: EvidenceKind,
        title: z.string(),
        content: z.string(),
        metadataJson: z.string().optional(),
      },
    },
    async ({ reviewRequestId, kind, title, content, metadataJson }) => {
      try {
        return ok(rwAddEvidence({ reviewRequestId, kind, title, content, metadataJson }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_evidence_list",
    {
      title: "List Review Evidence",
      description: "List all evidence for a review request",
      inputSchema: {
        reviewRequestId: z.string(),
      },
    },
    async ({ reviewRequestId }) => {
      try {
        return ok(rwListEvidence(reviewRequestId));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_changes_request",
    {
      title: "Request Changes",
      description: "Create a change request for a review — blocks approval gate",
      inputSchema: {
        reviewRequestId: z.string(),
        summary: z.string(),
        items: z.string().optional(),
      },
    },
    async ({ reviewRequestId, summary, items }) => {
      try {
        return ok(rwRequestChanges({ reviewRequestId, summary, items }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_changes_address",
    {
      title: "Address Change Request",
      description: "Mark a change request as addressed",
      inputSchema: {
        changeRequestId: z.string(),
        evidenceId: z.string().optional(),
      },
    },
    async ({ changeRequestId, evidenceId }) => {
      try {
        return ok(rwAddressChange({ changeRequestId, evidenceId }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_gate",
    {
      title: "Evaluate Approval Gate",
      description: "Check if a review passes the approval gate",
      inputSchema: {
        reviewRequestId: z.string(),
      },
    },
    async ({ reviewRequestId }) => {
      try {
        return ok(rwEvaluateGate(reviewRequestId));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_approve",
    {
      title: "Approve Review",
      description: "Approve a review (gate must be PASSED)",
      inputSchema: {
        reviewRequestId: z.string(),
        summary: z.string(),
      },
    },
    async ({ reviewRequestId, summary }) => {
      try {
        return ok(rwApproveReview({ reviewRequestId, summary }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_block",
    {
      title: "Block Review",
      description: "Block a review with optional change request",
      inputSchema: {
        reviewRequestId: z.string(),
        summary: z.string(),
        requestedChanges: z.string().optional(),
      },
    },
    async ({ reviewRequestId, summary, requestedChanges }) => {
      try {
        return ok(rwBlockReview({ reviewRequestId, summary, requestedChanges }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_review_packet",
    {
      title: "Review Packet",
      description: "Get full review packet including checklist, evidence, changes, gate, and context",
      inputSchema: {
        reviewRequestId: z.string(),
      },
    },
    async ({ reviewRequestId }) => {
      try {
        return ok(rwPrepareReviewPacket(reviewRequestId));
      } catch (e) { return fail(e); }
    }
  );
}
