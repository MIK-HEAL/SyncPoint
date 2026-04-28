import { z } from "zod";
import { AgentStatus } from "syncpoint-core";
import { createAgent, getAgent, listAgents, updateAgentStatus } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const agentRouter = t.router({
  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      provider: z.enum(["codex", "claude-code", "cursor", "cline", "copilot", "human", "other"]),
      role: z.enum(["manager", "frontend", "backend", "tester", "reviewer", "other"]),
    }))
    .mutation(({ input }) => createAgent(input)),

  list: publicProcedure
    .query(() => listAgents()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getAgent(input.id)),

  updateStatus: publicProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(AgentStatus) }))
    .mutation(({ input }) => updateAgentStatus(input.id, input.status)),
});
