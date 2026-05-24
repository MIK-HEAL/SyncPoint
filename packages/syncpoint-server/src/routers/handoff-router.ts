import { z } from "zod";
import { createHandoff, acceptHandoff, rejectHandoff } from "../repositories/_exports/context-memory.js";
import { t, publicProcedure } from "./_trpc.js";

export const handoffRouter = t.router({
  create: publicProcedure
    .input(z.object({
      fromAgentId: z.string(),
      toAgentId: z.string(),
      taskId: z.string(),
      contextSummary: z.string().min(1),
    }))
    .mutation(({ input }) => createHandoff(input)),

  accept: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => acceptHandoff(input.id)),

  reject: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => rejectHandoff(input.id)),
});
