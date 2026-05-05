/**
 * Sync Status Router — thin transport adapter for Editor Sync View (P9).
 *
 * All aggregation, scoping, and blocker classification lives in
 * sync-status-service.ts.  This router only handles input validation
 * and delegates to the service layer.
 *
 * Two endpoints:
 *   overview  — legacy compact summary (backward-compatible)
 *   snapshot  — comprehensive sync map for the VS Code Sync View
 */
import { z } from "zod";
import { buildOverview, buildSnapshot } from "../application/sync-status-service.js";
import { t, publicProcedure } from "./_trpc.js";

// ── router ───────────────────────────────────────────

export const syncStatusRouter = t.router({

  /**
   * Legacy overview — kept for backward compatibility.
   */
  overview: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      taskId: z.string().optional(),
    }).optional())
    .query(({ input }) => buildOverview(input ?? undefined)),

  /**
   * P9 Snapshot — comprehensive sync map for the Editor Sync View.
   *
   * Sections:
   *   1. sessions    — active sessions with relationship mode & role info
   *   2. agents      — each agent's task, status, blocked state, claims
   *   3. resourceOwnership — active claims, conflicts, exclusive/shared breakdown
   *   4. blockers    — every pending gate, transaction, handoff, review, operation
   *   5. operations  — operations awaiting action
   *   6. wakeQueue   — wake requests with semantic origin
   */
  snapshot: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
    }).optional())
    .query(({ input }) => buildSnapshot(input ?? undefined)),
});
