import { z } from "zod";
import { createCapsule, listCapsules, getLatestCapsule } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const capsuleRouter = t.router({
  create: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string(),
      checkpointId: z.string(),
      goal: z.string().default(""),
      currentPhase: z.string().default(""),
      confirmedDecisions: z.string().default(""),
      interfaceContract: z.string().default(""),
      workingResources: z.string().default(""),
      completedWork: z.string().default(""),
      remainingWork: z.string().default(""),
      risks: z.string().default(""),
      blockers: z.string().default(""),
      nextSteps: z.string().default(""),
      resumePrompt: z.string().default(""),
    }))
    .mutation(({ input }) => createCapsule(input)),

  list: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => listCapsules(input.taskId)),

  getLatest: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => getLatestCapsule(input.taskId, input.agentId)),
});
