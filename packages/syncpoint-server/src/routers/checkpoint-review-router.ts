/**
 * tRPC router for SyncTransaction — create, approve, reject, resolve, cancel.
 */

import { z } from "zod";
import { t, publicProcedure } from "./_trpc.js";
import {
  stxCreate,
  stxApprove,
  stxReject,
  stxResolve,
  stxCancel,
  stxStatus,
  stxList,
} from "../application/checkpoint-review-service.js";

export const checkpointReviewRouter = t.router({
  create: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      taskId: z.string(),
      checkpointId: z.string(),
      requestingAgentId: z.string(),
      requiredApproverIds: z.array(z.string()).min(1),
    }))
    .mutation(({ input }) => stxCreate(input)),

  approve: publicProcedure
    .input(z.object({
      txId: z.string(),
      agentId: z.string(),
      summary: z.string().optional(),
    }))
    .mutation(({ input }) => stxApprove(input.txId, input.agentId, input.summary)),

  reject: publicProcedure
    .input(z.object({
      txId: z.string(),
      agentId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(({ input }) => stxReject(input.txId, input.agentId, input.reason)),

  resolve: publicProcedure
    .input(z.object({
      txId: z.string(),
      decisionSummary: z.string().optional(),
    }))
    .mutation(({ input }) => stxResolve(input.txId, input.decisionSummary)),

  cancel: publicProcedure
    .input(z.object({
      txId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(({ input }) => stxCancel(input.txId, input.reason)),

  status: publicProcedure
    .input(z.object({ txId: z.string() }))
    .query(({ input }) => stxStatus(input.txId)),

  list: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      taskId: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(({ input }) => stxList(input ?? {})),
});
