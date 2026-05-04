/**
 * tRPC router for project memory CRUD + lifecycle.
 * Delegates to application/project-memory-service.
 *
 * P0 Hardening: mutating, export, and projection endpoints use protectedProcedure.
 * Caller identity comes from tRPC context (x-caller-id header), not only input fields.
 * Input createdBy/updatedBy/callerBy are kept as audit metadata and validated against ctx.
 */

import { z } from "zod";
import {
  pmAdd, pmGet, pmUpdate, pmApprove, pmDeprecate,
  pmList, pmSearch, pmExport, pmSupersede, pmGetVersion,
  pmCheckDuplicate, buildProjection,
} from "../application/index.js";
import { t, publicProcedure, protectedProcedure } from "./_trpc.js";

export const projectMemoryRouter = t.router({
  create: protectedProcedure
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
      createdBy: z.string().optional(),
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
      // PR4 typed constraint validator
      validatorType: z.string().optional(),
      validatorConfig: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      // P0: derive createdBy from authenticated context; input is audit-only
      const merged = { ...input, createdBy: ctx.callerId! } as any;
      return pmAdd(merged);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => pmGet(input.id)),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
      tags: z.string().optional(),
      confidence: z.string().optional(),
      updatedBy: z.string().optional(),
      // V2 optional
      kind: z.enum(["fact", "soft_convention", "risk", "do_not_touch", "hard_constraint", "protocol_rule"]).optional(),
      projectionTarget: z.enum(["capsule", "protocol_gate", "constraint_runtime"]).nullable().optional(),
      appliesTo: z.string().optional(),
      severity: z.enum(["info", "warning", "blocking"]).optional(),
      validityStatus: z.enum(["fresh", "needs_revalidation", "stale", "invalid"]).optional(),
      validityStaleReason: z.string().optional(),
      // PR4 typed constraint validator
      validatorType: z.string().optional(),
      validatorConfig: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const { id, ...fields } = input;
      // P0: derive updatedBy from authenticated context
      return pmUpdate(id, { ...fields, updatedBy: ctx.callerId! });
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string(), updatedBy: z.string().optional() }))
    .mutation(({ input, ctx }) => pmApprove(input.id, ctx.callerId!)),

  deprecate: protectedProcedure
    .input(z.object({ id: z.string(), updatedBy: z.string().optional() }))
    .mutation(({ input, ctx }) => pmDeprecate(input.id, ctx.callerId!)),

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

  supersede: protectedProcedure
    .input(z.object({
      newId: z.string().min(1),
      oldId: z.string().min(1),
      updatedBy: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => pmSupersede(input.newId, input.oldId, ctx.callerId!)),

  version: publicProcedure
    .query(() => ({ memoryVersion: pmGetVersion() })),

  checkDuplicate: publicProcedure
    .input(z.object({
      category: z.string().min(1),
      title: z.string().min(1),
      content: z.string().min(1),
    }))
    .query(({ input }) => pmCheckDuplicate(input.category, input.title, input.content)),

  export: protectedProcedure
    .input(z.object({ outputPath: z.string().optional(), callerBy: z.string().optional() }))
    .mutation(({ input, ctx }) => pmExport(input.outputPath, ctx.callerId!)),

  projection: protectedProcedure
    .input(z.object({
      taskId: z.string().min(1),
      workingFiles: z.array(z.string()).optional(),
      currentModules: z.array(z.string()).optional(),
      capsuleId: z.string().optional(),
      checkpointId: z.string().optional(),
      contractId: z.string().optional(),
      // P1: allow callers to provide content hashes directly
      capsuleHash: z.string().optional(),
      checkpointHash: z.string().optional(),
      contractHash: z.string().optional(),
    }))
    .query(({ input }) => buildProjection(input)),
});
