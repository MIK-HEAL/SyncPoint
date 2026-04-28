import { z } from "zod";
import { ContractStatus } from "syncpoint-core";
import { createContract, getContract, getContractForTask, updateContractStatus } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const contractRouter = t.router({
  create: publicProcedure
    .input(z.object({
      taskId: z.string(),
      title: z.string().default(""),
      participants: z.string().default(""),
      scope: z.string().default(""),
      responsibilities: z.string().default(""),
      interfaceSpec: z.string().default(""),
      fileBoundaries: z.string().default(""),
      dependencies: z.string().default(""),
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

  updateStatus: publicProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(ContractStatus) }))
    .mutation(({ input }) => updateContractStatus(input.id, input.status)),
});
