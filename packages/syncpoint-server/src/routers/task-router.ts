import { z } from "zod";
import { TaskStatus } from "syncpoint-core";
import { createTask, getTask, listTasks, assignTask, updateTaskStatus } from "../repositories.js";
import { t, publicProcedure } from "./_trpc.js";

export const taskRouter = t.router({
  create: publicProcedure
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

  assign: publicProcedure
    .input(z.object({ taskId: z.string(), agentId: z.string() }))
    .mutation(({ input }) => assignTask(input.taskId, input.agentId)),

  updateStatus: publicProcedure
    .input(z.object({ taskId: z.string(), status: z.nativeEnum(TaskStatus) }))
    .mutation(({ input }) => updateTaskStatus(input.taskId, input.status)),
});
