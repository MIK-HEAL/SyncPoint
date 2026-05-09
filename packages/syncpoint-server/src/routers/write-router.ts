import { z } from "zod";
import { WriteIntent } from "syncpoint-core";
import { writeApply, writeCheck, writePrepare } from "../application/write-permit-service.js";
import { publicProcedure, t } from "./_trpc.js";

const resourceRefInput = z.object({
  type: z.string().default("file"),
  locator: z.string(),
  metadata: z.string().optional().default(""),
});

const resourceHashInput = z.object({
  resource: resourceRefInput,
  sha256: z.string().optional(),
  exists: z.boolean(),
});

const writeRequestInput = z.object({
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  resources: z.array(resourceRefInput).min(1),
  intent: z.nativeEnum(WriteIntent),
  operationId: z.string().optional(),
  baseHashes: z.array(resourceHashInput).optional(),
});

const mutationInput = z.object({
  resource: resourceRefInput,
  content: z.string().optional(),
  contentBase64: z.string().optional(),
  delete: z.boolean().optional(),
});

export const writeRouter = t.router({
  check: publicProcedure
    .input(writeRequestInput)
    .query(({ input }) => writeCheck(input)),

  prepare: publicProcedure
    .input(writeRequestInput.extend({
      ttlSeconds: z.number().int().min(1).optional(),
      singleUse: z.boolean().optional(),
    }))
    .mutation(({ input }) => writePrepare(input)),

  applyWrite: publicProcedure
    .input(z.object({
      permitId: z.string(),
      mutations: z.array(mutationInput).min(1),
    }))
    .mutation(({ input }) => writeApply(input)),
});
