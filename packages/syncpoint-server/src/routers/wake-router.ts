/**
 * tRPC router for Wake Engine — list, acknowledge, complete wake requests.
 */

import { z } from "zod";
import { t, publicProcedure } from "./_trpc.js";
import {
  wakeList,
  wakeGet,
  wakeAck,
  wakeStart,
  wakeDone,
  wakeFail,
  wakeSkip,
  wakeNext,
  wakeEngineStats,
} from "../application/wake-engine-service.js";

export const wakeRouter = t.router({
  list: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      agentId: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(({ input }) => wakeList(input)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => wakeGet(input.id)),

  next: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(({ input }) => wakeNext(input.agentId)),

  ack: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => wakeAck(input.id)),

  start: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => wakeStart(input.id)),

  done: publicProcedure
    .input(z.object({ id: z.string(), resultSummary: z.string().optional() }))
    .mutation(({ input }) => wakeDone(input.id, input.resultSummary)),

  fail: publicProcedure
    .input(z.object({ id: z.string(), resultSummary: z.string().optional() }))
    .mutation(({ input }) => wakeFail(input.id, input.resultSummary)),

  skip: publicProcedure
    .input(z.object({ id: z.string(), resultSummary: z.string().optional() }))
    .mutation(({ input }) => wakeSkip(input.id, input.resultSummary)),

  stats: publicProcedure
    .query(() => wakeEngineStats()),
});
