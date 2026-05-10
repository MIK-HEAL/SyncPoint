import { z } from "zod";
import { createContextSnapshot, listContextSnapshots, getLatestContextSnapshot } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const contextSnapshotRouter = t.router({
  create: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string(),
      checkpointId: z.string().optional(),
      kind: z.enum(["resume", "handoff", "review", "system"]).default("resume"),
      summary: z.string().default(""),
      payloadJson: z.string().default("{}"),
    }))
    .mutation(({ input }) => createContextSnapshot(input)),

  list: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => listContextSnapshots(input.taskId)),

  getLatest: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => getLatestContextSnapshot(input.taskId, input.agentId)),
});