import { z } from "zod";
import { ContractStatus } from "syncpoint-adapters";
import { createContract, getContract, getContractForTask, updateContractStatus } from "../repositories/_exports/context-memory.js";
import { t, publicProcedure, protectedProcedure } from "./_trpc.js";

export const contractRouter = t.router({
  create: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      title: z.string().default(""),
      participants: z.array(z.string()).default([]),
      scope: z.string().default(""),
      responsibilities: z.array(z.string()).default([]),
      interfaceSpec: z.array(z.string()).default([]),
      resourceBoundaries: z.array(z.string()).default([]),
      dependencies: z.array(z.string()).default([]),
      testPlan: z.string().default(""),
      risks: z.string().default(""),
    }))
    .mutation(({ input }) => createContract(input)),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getContract(input.id)),

  getForTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => getContractForTask(input.taskId)),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(ContractStatus) }))
    .mutation(({ input }) => updateContractStatus(input.id, input.status)),
});
