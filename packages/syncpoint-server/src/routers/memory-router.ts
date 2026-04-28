import { z } from "zod";
import {
  createPinnedMemory,
  getPinnedMemory,
  listPinnedMemories,
  updatePinnedMemory,
  deletePinnedMemory,
} from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const pinnedMemoryRouter = t.router({
  create: publicProcedure
    .input(z.object({
      key: z.string().min(1),
      content: z.string().min(1),
      scope: z.enum(["global", "project", "task"]).default("project"),
      taskId: z.string().nullable().default(null),
    }))
    .mutation(({ input }) => createPinnedMemory(input)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getPinnedMemory(input.id)),

  list: publicProcedure
    .input(z.object({
      scope: z.string().optional(),
      taskId: z.string().optional(),
    }).default({}))
    .query(({ input }) => listPinnedMemories(input.scope, input.taskId)),

  update: publicProcedure
    .input(z.object({ id: z.string(), content: z.string().min(1) }))
    .mutation(({ input }) => updatePinnedMemory(input.id, input.content)),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => { deletePinnedMemory(input.id); return { ok: true }; }),
});
