/**
 * P4D — Constraint Runtime Router (tRPC transport adapter).
 *
 * Read-only queries for constraint runtime decisions.
 * Delegates to constraint-evaluation-service.ts.
 */
import { z } from "zod";
import { constraintCheck } from "../application/constraint-evaluation-service.js";
import { t, publicProcedure } from "./_trpc.js";

const ConstraintCheckActionSchema = z.enum([
  "resume",
  "start_assignment",
  "wake_start",
  "operation_submit",
  "operation_apply",
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
      operationId: z.string().optional(),
      contextMode: z.enum(["snapshot-first", "snapshot-only", "snapshot-locked"]).optional(),
      touchedResources: z.array(z.string()).optional(),
    }))
    .query(({ input }) => constraintCheck(input as any)),
});
