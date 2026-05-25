import { z } from "zod";
import {
  getAgentManifestDirectory,
  listDeclaredAgents,
  removeDeclaredAgentFile,
  syncDeclaredAgentFile,
  syncDeclaredAgents,
} from "../application/agent-registry-service.js";
import { t, publicProcedure } from "./_trpc.js";

export const agentRegistryRouter = t.router({
  manifestDirectory: publicProcedure
    .query(() => ({ path: getAgentManifestDirectory() })),

  list: publicProcedure
    .input(z.object({ includeRemoved: z.boolean().optional() }).optional())
    .query(({ input }) => listDeclaredAgents({ includeRemoved: input?.includeRemoved })),

  sync: publicProcedure
    .mutation(() => syncDeclaredAgents()),

  syncFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(({ input }) => syncDeclaredAgentFile(input.filePath)),

  removeFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(({ input }) => removeDeclaredAgentFile(input.filePath)),
});
