/**
 * tRPC router for PatchProposal — propose, check, approve, reject, apply.
 */

import { z } from "zod";
import { t, publicProcedure } from "./_trpc.js";
import {
  ppPropose, ppSubmit, ppCheck, ppApprove,
  ppReject, ppApply, ppCancel, ppStatus, ppList,
} from "../application/patch-proposal-service.js";

export const patchProposalRouter = t.router({
  propose: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      taskId: z.string(),
      agentId: z.string(),
      title: z.string(),
      summary: z.string().optional(),
      patchText: z.string(),
    }))
    .mutation(({ input }) => ppPropose(input)),

  submit: publicProcedure
    .input(z.object({ patchId: z.string() }))
    .mutation(({ input }) => ppSubmit(input.patchId)),

  check: publicProcedure
    .input(z.object({ patchId: z.string() }))
    .query(({ input }) => ppCheck(input.patchId)),

  approve: publicProcedure
    .input(z.object({
      patchId: z.string(),
      agentId: z.string(),
      summary: z.string().optional(),
    }))
    .mutation(({ input }) => ppApprove(input.patchId, input.agentId, input.summary)),

  reject: publicProcedure
    .input(z.object({
      patchId: z.string(),
      agentId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(({ input }) => ppReject(input.patchId, input.agentId, input.reason)),

  applyPatch: publicProcedure
    .input(z.object({ patchId: z.string() }))
    .mutation(({ input }) => ppApply(input.patchId)),

  cancel: publicProcedure
    .input(z.object({ patchId: z.string(), reason: z.string().optional() }))
    .mutation(({ input }) => ppCancel(input.patchId, input.reason)),

  status: publicProcedure
    .input(z.object({ patchId: z.string() }))
    .query(({ input }) => ppStatus(input.patchId)),

  list: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      taskId: z.string().optional(),
      agentId: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(({ input }) => ppList(input ?? {})),
});
