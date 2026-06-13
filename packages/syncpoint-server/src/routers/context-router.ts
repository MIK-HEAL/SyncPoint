import { z } from "zod";
import { getResumeContext, enforceContextPolicy } from "../repositories/_exports/context-memory.js";
import { listEvents } from "../repositories/_exports/foundation.js";
import { buildAdapterInstruction, getAdapterConfig, listAdapterProviders } from "syncpoint-adapters";
import type { AdapterLifecycleEvent as LifecycleEvent, AgentProvider } from "syncpoint-adapters";
import { t, publicProcedure } from "./_trpc.js";

export const resumeContextRouter = t.router({
  get: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => {
      const ctx = getResumeContext(input.taskId, input.agentId);
      ctx.projectMemories = []; // P3B: no raw PM in resume output
      ctx.resumePrompt = ""; // P3B: pre-built prompt contains baked-in raw PM
      return ctx;
    }),

  enforce: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => enforceContextPolicy(input.taskId, input.agentId)),
});

export const eventRouter = t.router({
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(1000).default(100) }))
    .query(({ input }) => listEvents(input.limit)),
});

export const adapterRouter = t.router({
  boot: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string(),
      provider: z.string().optional(),
      event: z.enum(["boot", "resume", "handoff", "checkpoint"]).default("resume"),
    }))
    .query(({ input }) => {
      const ctx = getResumeContext(input.taskId, input.agentId);
      ctx.projectMemories = []; // P3B: no raw PM in adapter output
      const provider = input.provider ?? ctx.agent.name;
      return buildAdapterInstruction(ctx, provider as AgentProvider, input.event as LifecycleEvent);
    }),

  info: publicProcedure
    .input(z.object({ provider: z.string() }))
    .query(({ input }) => {
      const config = getAdapterConfig(input.provider);
      if (!config) return { providers: listAdapterProviders(), config: null };
      return { providers: listAdapterProviders(), config };
    }),
});
