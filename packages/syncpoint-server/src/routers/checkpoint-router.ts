import { z } from "zod";
import { DiaryEntryType } from "syncpoint-adapters";
import { createCheckpoint, listCheckpoints, createDiaryEntry, listDiaryEntries } from "../repositories/_exports/context-memory.js";
import { t, publicProcedure, protectedProcedure } from "./_trpc.js";

export const checkpointRouter = t.router({
  create: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string(),
      summary: z.string().min(1),
      progress: z.string().default(""),
      currentUnderstanding: z.string().default(""),
      changedResources: z.array(z.string()).default([]),
      risks: z.string().default(""),
      blockers: z.string().default(""),
      nextSteps: z.string().default(""),
      needSync: z.boolean().default(false),
    }))
    .mutation(({ input }) => createCheckpoint(input)),

  list: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => listCheckpoints(input.taskId)),
});

export const diaryRouter = t.router({
  create: protectedProcedure
    .input(z.object({
      agentId: z.string(),
      taskId: z.string(),
      entryType: z.nativeEnum(DiaryEntryType).default(DiaryEntryType.NOTE),
      content: z.string().min(1),
    }))
    .mutation(({ input }) => createDiaryEntry(input)),

  list: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .query(({ input }) => listDiaryEntries(input.taskId)),
});
