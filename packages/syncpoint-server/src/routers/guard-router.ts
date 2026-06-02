import { z } from "zod";
import { guardCreateSession, guardRevokeSession, guardStatus, guardValidateToken } from "../application/guard-session-service.js";
import { publicProcedure, protectedProcedure, t } from "./_trpc.js";

const modeInput = z.enum(["observe", "stage", "strict", "readonly"]);
const adapterInput = z.enum(["winfsp", "fuse", "macfuse", "manual"]);

export const guardRouter = t.router({
  status: publicProcedure
    .query(() => guardStatus()),

  createSession: protectedProcedure
    .input(z.object({
      actorId: z.string(),
      taskId: z.string(),
      sessionId: z.string().optional(),
      mode: modeInput.optional(),
      mountPath: z.string().optional(),
      adapter: adapterInput.optional(),
      ttlSeconds: z.number().int().min(1).optional(),
    }))
    .mutation(({ input }) => guardCreateSession(input)),

  validateToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(({ input }) => guardValidateToken(input.token)),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => guardRevokeSession(input.sessionId)),
});
