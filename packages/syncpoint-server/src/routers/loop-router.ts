/**
 * tRPC router for loop use cases.
 * Delegates to application/loop-service — the single implementation.
 */

import { z } from "zod";
import {
  loopBoot,
  loopResume,
  loopCheckpoint,
  loopHandoff,
  loopStatus,
} from "../application/index.js";
import { t, publicProcedure } from "./_trpc.js";

export const loopRouter = t.router({
  boot: publicProcedure
    .input(z.object({
      agentId: z.string(),
      taskId: z.string(),
      provider: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const result = loopBoot(input);
      const { files, ...rest } = result;
      return rest;
    }),

  resume: publicProcedure
    .input(z.object({
      agentId: z.string(),
      taskId: z.string(),
      provider: z.string().optional(),
      format: z.enum(["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"]).optional(),
      contextMode: z.enum(["capsule-first", "capsule-only", "capsule-locked"]).optional(),
      sessionId: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const result = loopResume(input);
      const { files, ...rest } = result;
      return rest;
    }),

  checkpoint: publicProcedure
    .input(z.object({
      agentId: z.string(),
      taskId: z.string(),
      summary: z.string().min(1),
      progress: z.string().optional(),
      nextSteps: z.string().optional(),
      risks: z.string().optional(),
      blockers: z.string().optional(),
      goal: z.string().optional(),
      phase: z.string().optional(),
      completed: z.string().optional(),
      remaining: z.string().optional(),
      workingFiles: z.string().optional(),
      resumePrompt: z.string().optional(),
      needSync: z.boolean().optional(),
      provider: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const result = loopCheckpoint(input);
      const { files, ...rest } = result;
      return rest;
    }),

  handoff: publicProcedure
    .input(z.object({
      taskId: z.string(),
      fromAgentId: z.string(),
      toAgentId: z.string(),
      context: z.string().min(1),
      autoAccept: z.boolean().optional(),
      provider: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const result = loopHandoff(input);
      const { files, ...rest } = result;
      return rest;
    }),

  status: publicProcedure
    .input(z.object({
      agentId: z.string(),
      taskId: z.string().optional(),
    }))
    .query(({ input }) => loopStatus(input)),
});
