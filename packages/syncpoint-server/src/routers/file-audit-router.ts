import { z } from "zod";
import { auditFileChange } from "../application/file-audit-service.js";
import { protectedProcedure, t } from "./_trpc.js";

export const fileAuditRouter = t.router({
  audit: protectedProcedure
    .input(z.object({
      actorId: z.string(),
      taskId: z.string(),
      sessionId: z.string().optional(),
      locator: z.string(),
      auditOnly: z.boolean().optional(),
    }))
    .mutation(({ input }) => auditFileChange(input)),
});
