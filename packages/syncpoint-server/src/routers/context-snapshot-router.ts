import { z } from "zod";
import { createContextSnapshot, listContextSnapshots, getLatestContextSnapshot } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

const ContextSnapshotPayloadSchema = z.object({
  goal: z.string().optional(),
  currentPhase: z.string().optional(),
  confirmedDecisions: z.array(z.string()).optional(),
  interfaceContract: z.unknown().optional(),
  completedWork: z.string().optional(),
  remainingWork: z.string().optional(),
  risks: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  resumePrompt: z.string().optional(),
  intentScope: z.string().optional(),
  nonGoals: z.array(z.string()).optional(),
  verifiedFacts: z.array(z.string()).optional(),
  unverifiedClaims: z.array(z.string()).optional(),
  evidenceRefs: z.array(z.string()).optional(),
  activeConstraints: z.array(z.string()).optional(),
  doNotTouch: z.array(z.string()).optional(),
  handoffInstructions: z.string().optional(),
  workingResources: z.array(z.string()).optional(),
});

export const contextSnapshotRouter = t.router({
  create: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string(),
      checkpointId: z.string().optional(),
      kind: z.enum(["resume", "handoff", "review", "system"]).default("resume"),
      summary: z.string().default(""),
      payload: ContextSnapshotPayloadSchema,
    }))
    .mutation(({ input }) => createContextSnapshot(input as any)),

  list: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => listContextSnapshots(input.taskId)),

  getLatest: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => getLatestContextSnapshot(input.taskId, input.agentId)),
});