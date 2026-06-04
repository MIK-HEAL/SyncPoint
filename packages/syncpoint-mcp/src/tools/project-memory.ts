import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  pmAdd,
  pmApprove,
  pmSearch,
  pmExport,
  pmSupersede,
  pmGetVersion,
} from "syncpoint-server/application";
import { ProjectMemoryCreateSchema } from "syncpoint-context";
import { resolveBoundAgentId } from "../identity.js";
import { fail, ok } from "./_shared.js";

export function registerProjectMemoryTools(server: McpServer): void {
  // ── syncpoint_project_memory_search ──
  server.registerTool(
    "syncpoint_project_memory_search",
    {
      title: "Search Project Memory",
      description: "Search approved project memories by keyword",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      try {
        const results = pmSearch(query);
        return ok({ count: results.length, results });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_add ──
  server.registerTool(
    "syncpoint_project_memory_add",
    {
      title: "Add Project Memory",
      description: "Add a new project memory note (created as draft, needs approval to enter context)",
      inputSchema: {
        category: z.enum(["overview", "architecture", "decision", "convention", "risk", "gotcha", "glossary", "file-map", "integration"]),
        title: z.string(),
        content: z.string(),
        scope: z.enum(["project", "domain", "task", "file"]).optional(),
        tags: z.array(z.string()).optional(),
        sourceType: z.enum(["human", "agent", "checkpoint", "handoff", "doc"]).optional(),
        sourceRef: z.string().optional(),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        taskId: z.string().nullable().optional(),
        kind: z.enum(["fact", "soft_convention", "risk", "do_not_touch", "hard_constraint", "protocol_rule"]).optional(),
        projectionTarget: z.enum(["context_snapshot", "protocol_gate", "constraint_runtime"]).nullable().optional(),
        appliesTo: z.record(z.string(), z.array(z.string())).optional(),
        severity: z.enum(["info", "warning", "blocking"]).optional(),
        validity: z.object({
          status: z.enum(["fresh", "needs_revalidation", "stale", "invalid"]).optional(),
          staleReason: z.string().optional(),
        }).optional(),
        validatorType: z.string().optional(),
        validatorConfig: z.object({
          message: z.string().optional(),
          actions: z.array(z.string()).optional(),
        }).catchall(z.unknown()).nullable().optional(),
        createdBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async (input) => {
      try {
        const data = ProjectMemoryCreateSchema.parse({
          ...input,
          scope: input.scope ?? "project",
          tags: input.tags ?? [],
          sourceType: input.sourceType ?? "agent",
          sourceRef: input.sourceRef ?? "",
          confidence: input.confidence ?? "medium",
          taskId: input.taskId ?? null,
          createdBy: input.createdBy || resolveBoundAgentId() || (() => { throw new Error("createdBy is required. Provide it explicitly or bind an agent first."); })(),
        });
        const mem = pmAdd(data);
        return ok({
          ok: true,
          operation: "project_memory_add",
          id: mem.id,
          status: mem.status,
          nextSuggestedAction: `Approve with syncpoint_project_memory_approve(id: "${mem.id}")`,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_approve ──
  server.registerTool(
    "syncpoint_project_memory_approve",
    {
      title: "Approve Project Memory",
      description: "Approve a draft project memory (makes it available in agent resume context)",
      inputSchema: {
        id: z.string(),
        updatedBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async ({ id, updatedBy }) => {
      try {
        const caller = updatedBy || resolveBoundAgentId() || "";
        const mem = pmApprove(id, caller);
        return ok({
          ok: true,
          operation: "project_memory_approve",
          id: mem.id,
          status: mem.status,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_export ──
  server.registerTool(
    "syncpoint_project_memory_export",
    {
      title: "Export Project Memory",
      description: "Export all approved project memories to .syncpoint/project-memory.md",
      inputSchema: {
        outputPath: z.string().optional(),
        callerBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async ({ outputPath, callerBy }) => {
      try {
        const caller = callerBy || resolveBoundAgentId() || "";
        const result = pmExport(outputPath, caller);
        return ok({
          ok: true,
          operation: "project_memory_export",
          path: result.path,
          count: result.count,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_supersede ──
  server.registerTool(
    "syncpoint_project_memory_supersede",
    {
      title: "Supersede Project Memory",
      description: "Mark a new memory as replacing an old one. The old memory is deprecated with a supersededBy link.",
      inputSchema: {
        newId: z.string().describe("ID of the new (replacement) memory"),
        oldId: z.string().describe("ID of the old memory to supersede"),
        updatedBy: z.string().optional().describe("Caller agent ID (auto-resolved if bound)"),
      },
    },
    async ({ newId, oldId, updatedBy }) => {
      try {
        const caller = updatedBy || resolveBoundAgentId() || "";
        const { newMem, oldMem } = pmSupersede(newId, oldId, caller);
        return ok({
          ok: true,
          operation: "project_memory_supersede",
          newId: newMem.id,
          oldId: oldMem.id,
          oldStatus: oldMem.status,
        });
      } catch (e) { return fail(e); }
    }
  );

  // ── syncpoint_project_memory_version ──
  server.registerTool(
    "syncpoint_project_memory_version",
    {
      title: "Project Memory Version",
      description: "Get the current approved memory set version counter. Bumps on approve, deprecate, supersede.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok({ memoryVersion: pmGetVersion() });
      } catch (e) { return fail(e); }
    }
  );
}
