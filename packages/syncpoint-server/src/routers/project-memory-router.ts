/**
 * tRPC router for project memory CRUD + lifecycle.
 * Delegates to application/project-memory-service.
 */

import { z } from "zod";
import {
  pmAdd, pmGet, pmUpdate, pmApprove, pmDeprecate,
  pmList, pmSearch, pmExport, pmSupersede, pmGetVersion,
  pmCheckDuplicate, buildProjection,
} from "../application/index.js";
import { t, publicProcedure } from "./_trpc.js";

export const projectMemoryRouter = t.router({
  create: publicProcedure
    .input(z.object({
      scope: z.enum(["project", "domain", "task", "file"]).optional(),
      category: z.enum(["overview", "architecture", "decision", "convention", "risk", "gotcha", "glossary", "file-map", "integration"]),
      title: z.string().min(1),
      content: z.string().min(1),
      tags: z.string().optional(),
      sourceType: z.enum(["human", "agent", "checkpoint", "handoff", "doc"]).optional(),
      sourceRef: z.string().optional(),
      confidence: z.enum(["low", "medium", "high"]).optional(),
      taskId: z.string().nullable().optional(),
      createdBy: z.string().min(1, "createdBy is required"),
      global: z.boolean().optional(),
      // V2 optional
      kind: z.enum(["fact", "soft_convention", "risk", "do_not_touch", "hard_constraint", "protocol_rule"]).optional(),
      projectionTarget: z.enum(["capsule", "protocol_gate", "constraint_runtime"]).nullable().optional(),
      appliesTo: z.object({
        files: z.array(z.string()).optional(),
        modules: z.array(z.string()).optional(),
        taskTypes: z.array(z.string()).optional(),
      }).optional(),
      severity: z.enum(["info", "warning", "blocking"]).optional(),
      validity: z.object({
        status: z.enum(["fresh", "needs_revalidation", "stale", "invalid"]).optional(),
        staleReason: z.string().optional(),
      }).optional(),
    }))
    .mutation(({ input }) => pmAdd(input as any)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => pmGet(input.id)),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.string().optional(),
      confidence: z.string().optional(),
      updatedBy: z.string().min(1, "updatedBy is required"),
      // V2 optional
      kind: z.enum(["fact", "soft_convention", "risk", "do_not_touch", "hard_constraint", "protocol_rule"]).optional(),
      projectionTarget: z.enum(["capsule", "protocol_gate", "constraint_runtime"]).nullable().optional(),
      appliesTo: z.string().optional(),
      severity: z.enum(["info", "warning", "blocking"]).optional(),
      validityStatus: z.enum(["fresh", "needs_revalidation", "stale", "invalid"]).optional(),
      validityStaleReason: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...fields } = input;
      return pmUpdate(id, fields);
    }),

  approve: publicProcedure
    .input(z.object({ id: z.string(), updatedBy: z.string().min(1, "updatedBy is required") }))
    .mutation(({ input }) => pmApprove(input.id, input.updatedBy)),

  deprecate: publicProcedure
    .input(z.object({ id: z.string(), updatedBy: z.string().min(1, "updatedBy is required") }))
    .mutation(({ input }) => pmDeprecate(input.id, input.updatedBy)),

  list: publicProcedure
    .input(z.object({
      status: z.string().optional(),
      category: z.string().optional(),
      scope: z.string().optional(),
      taskId: z.string().optional(),
    }).optional())
    .query(({ input }) => pmList(input)),

  search: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(({ input }) => pmSearch(input.query)),

  supersede: publicProcedure
    .input(z.object({
      newId: z.string().min(1),
      oldId: z.string().min(1),
      updatedBy: z.string().min(1, "updatedBy is required"),
    }))
    .mutation(({ input }) => pmSupersede(input.newId, input.oldId, input.updatedBy)),

  version: publicProcedure
    .query(() => ({ memoryVersion: pmGetVersion() })),

  checkDuplicate: publicProcedure
    .input(z.object({
      category: z.string().min(1),
      title: z.string().min(1),
      content: z.string().min(1),
    }))
    .query(({ input }) => pmCheckDuplicate(input.category, input.title, input.content)),

  export: publicProcedure
    .input(z.object({ outputPath: z.string().optional(), callerBy: z.string().min(1, "callerBy is required") }))
    .mutation(({ input }) => pmExport(input.outputPath, input.callerBy)),

  projection: publicProcedure
    .input(z.object({
      taskId: z.string().min(1),
      workingFiles: z.array(z.string()).optional(),
      currentModules: z.array(z.string()).optional(),
      capsuleId: z.string().optional(),
      checkpointId: z.string().optional(),
      contractId: z.string().optional(),
    }))
    .query(({ input }) => buildProjection(input)),
});
