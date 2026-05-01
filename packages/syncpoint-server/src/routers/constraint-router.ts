/**
 * P4D — Constraint Runtime Router (tRPC transport adapter).
 *
 * Read-only queries for constraint runtime decisions.
 * Delegates to constraint-runtime-service.ts.
 */
import { z } from "zod";
import { constraintCheck } from "../application/constraint-runtime-service.js";
import { t, publicProcedure } from "./_trpc.js";

const ConstraintCheckActionSchema = z.enum([
  "resume",
  "start_assignment",
  "wake_start",
  "patch_submit",
  "patch_apply",
]);

export const constraintRouter = t.router({

  /**
   * P4D: Evaluate constraint runtime for a given action context.
   * Returns blockers/warnings with projected refs only (no raw PM content).
   */
  check: publicProcedure
    .input(z.object({
      action: ConstraintCheckActionSchema,
      taskId: z.string().optional(),
      agentId: z.string().optional(),
      sessionId: z.string().optional(),
      assignmentId: z.string().optional(),
      wakeRequestId: z.string().optional(),
      patchId: z.string().optional(),
      contextMode: z.enum(["capsule-first", "capsule-only", "capsule-locked"]).optional(),
      touchedFiles: z.array(z.string()).optional(),
    }))
    .query(({ input }) => constraintCheck(input as any)),
});
