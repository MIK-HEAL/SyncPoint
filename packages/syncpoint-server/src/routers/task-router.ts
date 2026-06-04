import { z } from "zod";
import { TaskStatus } from "syncpoint-adapters";
import { createTask, getTask, listTasks, assignTask, updateTaskStatus } from "../repositories/_exports/foundation.js";
import { t, publicProcedure, protectedProcedure } from "./_trpc.js";

export const taskRouter = t.router({
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().default(""),
    }))
    .mutation(({ input }) => createTask(input)),

  list: publicProcedure
    .query(() => listTasks()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getTask(input.id)),

  assign: protectedProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .mutation(({ input }) => assignTask(input.taskId, input.agentId)),

  updateStatus: protectedProcedure
    .input(z.object({ taskId: z.string(), status: z.nativeEnum(TaskStatus) }))
    .mutation(({ input }) => updateTaskStatus(input.taskId, input.status)),
});
