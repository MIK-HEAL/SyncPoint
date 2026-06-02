import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  rcClaim,
  rcRelease,
  rcList,
  rcDetectConflicts,
} from "syncpoint-server/application";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerResourceTools(server: McpServer): void {
  // ═══════════════════════════════════════════════════════
  // ResourceClaim / Conflict Awareness Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_resource_claim",
    {
      title: "Claim Resources",
      description: "Declare resource ownership for a task. Returns the claim and any detected conflicts with other agents. Use this BEFORE modifying resources to prevent uncoordinated parallel edits. agentId is optional if connection is identity-bound.",
      inputSchema: {
        agentId: z.string().optional(),
        taskId: z.string(),
        sessionId: z.string().optional(),
        locators: z.string().describe("Comma-separated resource locators, e.g. 'src/auth.ts, src/api/*' or 'assets/hero.png'"),
        type: z.string().optional().describe("Resource type (default: 'file'). Use 'binary_asset', 'db_table', etc. for non-code resources"),
        mode: z.enum(["exclusive", "shared"]).optional().describe("exclusive = only this agent may modify; shared = aware of overlap"),
        scope: z.enum(["file", "function", "line_range"]).optional().describe("Claim granularity: 'file' (whole file, default), 'function' (specific function), 'line_range' (specific lines). Reduces false conflicts when agents edit different parts of the same file."),
        functionName: z.string().optional().describe("Function name when scope='function'. E.g. 'login', 'handleSubmit'. Two agents claiming different functions in the same file will NOT conflict."),
        lineStart: z.number().optional().describe("Start line (1-indexed) when scope='line_range'"),
        lineEnd: z.number().optional().describe("End line (1-indexed, inclusive) when scope='line_range'"),
      },
    },
    async ({ agentId, taskId, sessionId, locators, type, mode, scope, functionName, lineStart, lineEnd }) => {
      try {
        const resolved = resolveBoundAgentId(agentId);
        if (!resolved) return fail(new Error("agentId required (no bound identity)"));
        const resourceType = type || "file";
        const resources = locators.split(",").map((p: string) => ({
          type: resourceType,
          locator: p.trim(),
          scope: scope || "file",
          metadata: "",
          ...(scope === "function" && functionName ? { functionName } : {}),
          ...(scope === "line_range" && lineStart != null && lineEnd != null ? { lineRange: { start: lineStart, end: lineEnd } } : {}),
        }));
        const result = rcClaim({ actorId: resolved, taskId, sessionId, resources, mode });
        if (result.conflicts.length > 0) {
          return ok({
            claim: result.claim,
            warning: result.gateId
              ? `${result.conflicts.length} conflict(s) detected — SyncGate ${result.gateId} auto-created. Agents must sync before continuing.`
              : `${result.conflicts.length} conflict(s) detected — consider creating a sync gate`,
            gateId: result.gateId,
            conflicts: result.conflicts.map((c: any) => ({
              overlap: c.overlappingLocator,
              actorA: c.claimA.actorId,
              actorB: c.claimB.actorId,
            })),
          });
        }
        return ok({ claim: result.claim, conflicts: [] });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_resource_release",
    {
      title: "Release Resource Claim",
      description: "Release a resource claim — marks it as released so the resources are no longer owned by this agent.",
      inputSchema: { claimId: z.string() },
    },
    async ({ claimId }) => {
      try { return ok(rcRelease(claimId)); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_resource_list",
    {
      title: "List Resource Claims",
      description: "List resource claims. Filter by actor, task, session, or status.",
      inputSchema: {
        actorId: z.string().optional(),
        taskId: z.string().optional(),
        sessionId: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (input) => {
      try { return ok({ claims: rcList(input) }); }
      catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_resource_conflicts",
    {
      title: "Detect Resource Conflicts",
      description: "Check for overlapping resource claims among active agents. Returns all conflict pairs with overlap details.",
      inputSchema: {
        sessionId: z.string().optional(),
      },
    },
    async ({ sessionId }) => {
      try {
        const conflicts = rcDetectConflicts(sessionId ? { sessionId } : undefined);
        return ok({
          hasConflicts: conflicts.length > 0,
          count: conflicts.length,
          conflicts: conflicts.map((c: any) => ({
            overlap: c.overlappingLocator,
            actorA: c.claimA.actorId,
            actorB: c.claimB.actorId,
          })),
        });
      } catch (e) { return fail(e); }
    }
  );
}
