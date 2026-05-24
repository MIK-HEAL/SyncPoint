import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  opCreate,
  opSubmit,
  opCheck,
  opApprove,
  opReject,
  opApply,
  opCancel,
  opStatus,
  opList,
} from "syncpoint-server/application";
import { fail, ok } from "./_shared.js";

export function registerOperationTools(server: McpServer): void {
  // Operation Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_operation_create",
    {
      title: "Create Operation",
      description: "Create a draft operation (e.g. code patch). Submit content and SyncPoint will track touched resources and check ownership/conflicts before allowing application.",
      inputSchema: {
        sessionId: z.string(),
        taskId: z.string(),
        actorId: z.string(),
        title: z.string(),
        type: z.string().optional().describe("Operation type, e.g. 'code_patch'"),
        summary: z.string().optional(),
        payload: z.string().optional().describe("Operation payload (e.g. unified diff patch text)"),
      },
    },
    async (input) => {
      try {
        const result = opCreate({ ...input, type: input.type || "code_patch" });
        return ok({ operation: result });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_submit",
    {
      title: "Submit Operation",
      description: "Submit a draft operation for checking. Auto-runs checks and moves to SUBMITTED or CONFLICTING.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        const result = opSubmit(operationId);
        return ok({ operation: result.operation, checkResult: result.checkResult });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_check",
    {
      title: "Check Operation",
      description: "Run checks on an operation without changing its status.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        const result = opCheck(operationId);
        return ok({ operation: result.operation, checkResult: result.checkResult });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_approve",
    {
      title: "Approve Operation",
      description: "Approve a submitted operation. The operation can then be applied.",
      inputSchema: {
        operationId: z.string(),
        actorId: z.string(),
        summary: z.string().optional(),
      },
    },
    async ({ operationId, actorId, summary }) => {
      try {
        return ok({ operation: opApprove(operationId, actorId, summary) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_reject",
    {
      title: "Reject Operation",
      description: "Reject a submitted operation. The actor can fix and resubmit.",
      inputSchema: {
        operationId: z.string(),
        actorId: z.string(),
        reason: z.string().optional(),
      },
    },
    async ({ operationId, actorId, reason }) => {
      try {
        return ok({ operation: opReject(operationId, actorId, reason) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_apply",
    {
      title: "Apply Operation",
      description: "Mark an approved operation as applied.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        return ok({ operation: opApply(operationId) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_cancel",
    {
      title: "Cancel Operation",
      description: "Cancel an operation.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        return ok({ operation: opCancel(operationId) });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_status",
    {
      title: "Operation Status",
      description: "Get operation status with check results.",
      inputSchema: { operationId: z.string() },
    },
    async ({ operationId }) => {
      try {
        const result = opStatus(operationId);
        return ok({ operation: result.operation, checkResult: result.checkResult });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_operation_list",
    {
      title: "List Operations",
      description: "List operations. Filter by type, actor, task, session, or status.",
      inputSchema: {
        type: z.string().optional(),
        actorId: z.string().optional(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return ok({ operations: opList(input) });
      } catch (e) { return fail(e); }
    }
  );
}
