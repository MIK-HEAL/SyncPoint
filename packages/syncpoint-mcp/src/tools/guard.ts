import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  writeCheck,
  writePrepare,
  writeApply,
  guardStatus,
  guardCreateSession,
  reconcileBackingStore,
  constraintCheck,
} from "syncpoint-server/application";
import { WriteIntent } from "syncpoint-core";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerGuardTools(server: McpServer): void {
  // Controlled Write Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_write_check",
    {
      title: "Check Controlled Write",
      description: "Dry-run a controlled write decision. Returns permit decision, blockers, and base hashes without writing files.",
      inputSchema: {
        actorId: z.string().optional(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        locators: z.array(z.string()).min(1),
        type: z.string().optional().default("file"),
        intent: z.enum(["create", "modify", "delete", "rename", "bulk"]).optional().default("modify"),
        operationId: z.string().optional(),
      },
    },
    async ({ actorId, taskId, sessionId, locators, type, intent, operationId }) => {
      try {
        const resolved = resolveBoundAgentId(actorId);
        if (!resolved) return fail(new Error("actorId required (no bound identity)"));
        return ok(writeCheck({
          actorId: resolved,
          taskId,
          sessionId,
          resources: locators.map(locator => ({ type: type ?? "file", scope: "file" as const, locator, metadata: "" })),
          intent: (intent ?? "modify") as WriteIntent,
          operationId,
        }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_write_prepare",
    {
      title: "Prepare Controlled Write",
      description: "Issue a short-lived write permit if claims, gates, operations, constraints, and hashes allow the write.",
      inputSchema: {
        actorId: z.string().optional(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        locators: z.array(z.string()).min(1),
        type: z.string().optional().default("file"),
        intent: z.enum(["create", "modify", "delete", "rename", "bulk"]).optional().default("modify"),
        operationId: z.string().optional(),
        ttlSeconds: z.number().int().min(1).optional(),
      },
    },
    async ({ actorId, taskId, sessionId, locators, type, intent, operationId, ttlSeconds }) => {
      try {
        const resolved = resolveBoundAgentId(actorId);
        if (!resolved) return fail(new Error("actorId required (no bound identity)"));
        return ok(writePrepare({
          actorId: resolved,
          taskId,
          sessionId,
          resources: locators.map(locator => ({ type: type ?? "file", scope: "file" as const, locator, metadata: "" })),
          intent: (intent ?? "modify") as WriteIntent,
          operationId,
          ttlSeconds,
        }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_write_apply",
    {
      title: "Apply Controlled Write",
      description: "Apply file mutations through an issued write permit. This is the L1 hard-blocking write path.",
      inputSchema: {
        permitId: z.string(),
        mutations: z.array(z.object({
          locator: z.string(),
          content: z.string().optional(),
          contentBase64: z.string().optional(),
          delete: z.boolean().optional(),
        })).min(1),
      },
    },
    async ({ permitId, mutations }) => {
      try {
        return ok(writeApply({
          permitId,
          mutations: mutations.map(mutation => ({
            resource: { type: "file", scope: "file" as const, locator: mutation.locator, metadata: "" },
            content: mutation.content,
            contentBase64: mutation.contentBase64,
            delete: mutation.delete,
          })),
        }));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_guard_status",
    {
      title: "Guard Status",
      description: "Show guarded workspace status, active guard sessions, and native proxy adapter availability.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(guardStatus());
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_guard_session_create",
    {
      title: "Create Guard Session",
      description: "Create a local guard capability token for editor/proxy adapters. This does not mount a native filesystem by itself.",
      inputSchema: {
        actorId: z.string(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        mode: z.enum(["observe", "stage", "strict", "readonly"]).optional(),
        mountPath: z.string().optional(),
        adapter: z.enum(["winfsp", "fuse", "macfuse", "manual"]).optional(),
        ttlSeconds: z.number().int().min(1).optional(),
      },
    },
    async (input) => {
      try {
        return ok(guardCreateSession(input));
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_guard_reconcile",
    {
      title: "Reconcile Backing Store",
      description: "Scan claimed files on the backing store for unauthorized direct writes (bypasses). Raises BACKING_STORE_BYPASS gates for detected modifications.",
      inputSchema: {
        taskId: z.string(),
        sessionId: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return ok(reconcileBackingStore(input));
      } catch (e) { return fail(e); }
    }
  );

  // ══════════════════════════════════════════════════════════
  // ── P4D Constraint Runtime (read-only visibility) ────────
  // ══════════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_constraint_check",
    {
      title: "Constraint Check",
      description:
        "Query the Constraint Runtime to check if an action is permitted. " +
        "Returns blockers, warnings, and projection metadata. Read-only — does not change any state. " +
        "Use this before executing to understand if and why you might be blocked.",
      inputSchema: {
        action: z.enum(["resume", "start_assignment", "wake_start", "operation_submit", "operation_apply"])
          .describe("The action to evaluate"),
        taskId: z.string().optional().describe("Task ID (required for resume, wake_start)"),
        agentId: z.string().optional().describe("Agent ID (required for resume, wake_start without wakeRequestId)"),
        sessionId: z.string().optional(),
        assignmentId: z.string().optional().describe("Assignment ID (required for start_assignment)"),
        wakeRequestId: z.string().optional().describe("Wake request ID (alternative to taskId+agentId for wake_start)"),
        operationId: z.string().optional().describe("Operation ID (required for operation_submit/operation_apply)"),
        touchedResources: z.array(z.string()).optional().describe("Override touched resources for debug/preview"),
      },
    },
    async (input) => {
      try {
        const result = constraintCheck(input as any);
        return ok(result);
      } catch (e) { return fail(e); }
    }
  );
}
