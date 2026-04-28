import { z } from "zod";
import { getResumeContext, enforceContextPolicy } from "../repositories.js";
import { listEvents } from "../repositories.js";
import { buildAdapterInstruction, getAdapterConfig, listAdapterProviders } from "syncpoint-core";
import type { AdapterLifecycleEvent as LifecycleEvent } from "syncpoint-core";
import { t, publicProcedure } from "./_trpc.js";

export const resumeContextRouter = t.router({
  get: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .query(({ input }) => getResumeContext(input.taskId, input.agentId)),

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
      const provider = input.provider ?? ctx.agent.name;
      return buildAdapterInstruction(ctx, provider as any, input.event as LifecycleEvent);
    }),

  info: publicProcedure
    .input(z.object({ provider: z.string() }))
    .query(({ input }) => {
      const config = getAdapterConfig(input.provider);
      if (!config) return { providers: listAdapterProviders(), config: null };
      return { providers: listAdapterProviders(), config };
    }),
});
