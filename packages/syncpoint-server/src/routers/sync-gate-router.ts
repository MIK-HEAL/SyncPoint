/**
 * Sync Gate Router — tRPC endpoints for gate inspection and decision actions.
 *
 * Provides:
 *   status    — detailed gate status (policy, votes, agents, liveness preview)
 *   vote      — cast or change a vote on a gate
 *   ack       — acknowledge a gate as a required agent
 *   resolve   — resolve a gate (owner/escalation)
 *   cancel    — cancel a gate
 *   list      — list gates with filters
 *   listActive — list active (blocking) gates
 */
import { z } from "zod";
import {
  sgStatusDetailed, sgVote, sgAck, sgResolve, sgCancel,
  sgList, sgListActive,
} from "../application/sync-gate-service.js";
import { t, publicProcedure, protectedProcedure } from "./_trpc.js";

export const syncGateRouter = t.router({

  status: publicProcedure
    .input(z.object({
      gateId: z.string(),
      agentId: z.string().optional(),
    }))
    .query(({ input }) => sgStatusDetailed(input.gateId, input.agentId)),

  vote: protectedProcedure
    .input(z.object({
      gateId: z.string(),
      agentId: z.string(),
      vote: z.enum(["approve", "reject", "abstain", "escalate"]),
      summary: z.string().optional().default(""),
    }))
    .mutation(({ input }) => sgVote(input.gateId, input.agentId, input.vote, input.summary)),

  ack: protectedProcedure
    .input(z.object({
      gateId: z.string(),
      agentId: z.string(),
      summary: z.string().optional().default(""),
    }))
    .mutation(({ input }) => sgAck(input.gateId, input.agentId, input.summary)),

  resolve: protectedProcedure
    .input(z.object({
      gateId: z.string(),
      summary: z.string().optional().default(""),
    }))
    .mutation(({ input }) => sgResolve(input.gateId, input.summary)),

  cancel: protectedProcedure
    .input(z.object({
      gateId: z.string(),
      reason: z.string().optional().default(""),
    }))
    .mutation(({ input }) => sgCancel(input.gateId, input.reason)),

  list: publicProcedure
    .input(z.object({
      taskId: z.string().optional(),
      sessionId: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(({ input }) => sgList(input ?? undefined)),

  listActive: publicProcedure
    .input(z.object({
      taskId: z.string().optional(),
      sessionId: z.string().optional(),
    }).optional())
    .query(({ input }) => sgListActive(input ?? undefined)),
});
