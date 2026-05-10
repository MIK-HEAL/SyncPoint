import { z } from "zod";
import { createCapsule, listCapsules, getLatestCapsule } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const capsuleRouter = t.router({
  create: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string(),
      checkpointId: z.string().optional(),
      kind: z.enum(["resume", "handoff", "review", "system"]).default("resume"),
      summary: z.string().default(""),
      payloadJson: z.string().default("{}"),
    }))
    .mutation(({ input }) => createCapsule(input)),

  list: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => listCapsules(input.taskId)),

  getLatest: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => getLatestCapsule(input.taskId, input.agentId)),
});