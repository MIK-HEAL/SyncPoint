/**
 * Agent Manifest Router — tRPC endpoints for manifest CRUD + escalation routing.
 */
import { z } from "zod";
import {
  manifestUpsert, manifestGet, manifestList, manifestDelete,
  routeGateEscalation,
} from "../application/escalation-routing-service.js";
import { t, publicProcedure } from "./_trpc.js";

export const agentManifestRouter = t.router({

  upsert: publicProcedure
    .input(z.object({
      agentId: z.string(),
      capabilities: z.array(z.object({
        domain: z.string(),
        skills: z.array(z.string()).optional().default([]),
        resourceTypes: z.array(z.string()).optional().default([]),
      })).optional(),
      escalationPreference: z.object({
        optIn: z.enum(["always", "when_available", "never"]).optional(),
        priority: z.number().int().min(0).max(100).optional(),
        maxConcurrentEscalations: z.number().int().min(0).optional(),
      }).optional(),
      availability: z.enum(["online", "busy", "offline"]).optional(),
      canHandleHumanEscalation: z.boolean().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(({ input }) => manifestUpsert(input.agentId, input as Parameters<typeof manifestUpsert>[1])),

  get: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(({ input }) => manifestGet(input.agentId)),

  list: publicProcedure
    .query(() => manifestList()),

  delete: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .mutation(({ input }) => { manifestDelete(input.agentId); return { ok: true }; }),

  routeEscalation: publicProcedure
    .input(z.object({ gateId: z.string() }))
    .query(({ input }) => routeGateEscalation(input.gateId)),
});
