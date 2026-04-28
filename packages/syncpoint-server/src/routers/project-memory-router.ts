/**
 * tRPC router for project memory CRUD + lifecycle.
 * Delegates to application/project-memory-service.
 */

import { z } from "zod";
import {
  pmAdd, pmGet, pmUpdate, pmApprove, pmDeprecate,
  pmList, pmSearch, pmExport,
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
      createdBy: z.string().optional(),
      global: z.boolean().optional(),
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
      updatedBy: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const { id, ...fields } = input;
      return pmUpdate(id, fields);
    }),

  approve: publicProcedure
    .input(z.object({ id: z.string(), updatedBy: z.string().optional() }))
    .mutation(({ input }) => pmApprove(input.id, input.updatedBy)),

  deprecate: publicProcedure
    .input(z.object({ id: z.string(), updatedBy: z.string().optional() }))
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

  export: publicProcedure
    .input(z.object({ outputPath: z.string().optional() }).optional())
    .mutation(({ input }) => pmExport(input?.outputPath)),
});
