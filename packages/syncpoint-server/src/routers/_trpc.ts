/**
 * Shared tRPC initialization.
 *
 * P0 Hardening: tRPC context carries authenticated caller identity.
 * - publicProcedure: no auth required (reads, metadata).
 * - protectedProcedure: requires `x-caller-id` header (mutations, exports, projection).
 */

import { initTRPC, TRPCError } from "@trpc/server";
import type { IncomingMessage } from "node:http";

// ── Context ─────────────────────────────────────────────

export interface TRPCContext {
  /** Authenticated caller identity, derived from x-caller-id header. null if absent. */
  callerId: string | null;
}

/**
 * Create tRPC context from the incoming HTTP request.
 * Extracts caller identity from the `x-caller-id` header.
 */
export function createContext(req: IncomingMessage): TRPCContext {
  const raw = req.headers["x-caller-id"];
  const callerId = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  return { callerId };
}

// ── tRPC init ───────────────────────────────────────────

export const t = initTRPC.context<TRPCContext>().create();

export const publicProcedure = t.procedure;

/**
 * Protected procedure: requires authenticated caller identity in context.
 * Rejects with UNAUTHORIZED if `x-caller-id` header is missing/empty.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.callerId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required. Provide x-caller-id header.",
    });
  }
  return next({
    ctx: { ...ctx, callerId: ctx.callerId },
  });
});
