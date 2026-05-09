/**
 * Negotiation Router — tRPC endpoints for negotiation protocol.
 *
 * Provides:
 *   start     — create session bound to a gate
 *   message   — post proposal/counter/accept/reject/comment
 *   reconcile — evaluate liveness (advance/deadlock/timeout)
 *   resolve   — human/owner resolves
 *   escalate  — escalate to human
 *   status    — detailed status with messages
 */
import { z } from "zod";
import {
  negStart, negMessage, negReconcile, negResolve, negEscalate, negStatus,
} from "../application/negotiation-service.js";
import { t, publicProcedure } from "./_trpc.js";

export const negotiationRouter = t.router({

  start: publicProcedure
    .input(z.object({
      gateId: z.string(),
      participantIds: z.array(z.string()).min(2),
      config: z.object({
        maxRounds: z.number().int().min(1).optional(),
        roundDeadlineMinutes: z.number().int().min(0).optional(),
        negotiationDeadlineMinutes: z.number().int().min(0).optional(),
      }).optional(),
    }))
    .mutation(({ input }) => negStart(input.gateId, input.participantIds, input.config)),

  message: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      agentId: z.string(),
      kind: z.enum(["PROPOSAL", "COUNTER", "ACCEPT", "REJECT", "COMMENT"]),
      content: z.string(),
    }))
    .mutation(({ input }) => negMessage(input.sessionId, input.agentId, input.kind, input.content)),

  reconcile: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => negReconcile(input.sessionId)),

  resolve: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      agentId: z.string(),
      summary: z.string().optional().default(""),
    }))
    .mutation(({ input }) => negResolve(input.sessionId, input.agentId, input.summary)),

  escalate: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => negEscalate(input.sessionId)),

  status: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => negStatus(input.sessionId)),
});
