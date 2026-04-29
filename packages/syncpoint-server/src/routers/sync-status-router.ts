/**
 * Sync Status Router — unified sync state for Editor Sync View (P5).
 *
 * Returns file claims, active sync gates, sessions with modes,
 * and agent work status in a single query.
 */
import { z } from "zod";
import * as repo from "../repositories.js";
import { sgListActive, sgList } from "../application/sync-gate-service.js";
import { fcListClaims, fcDetectConflicts } from "../application/file-claim-service.js";
import { t, publicProcedure } from "./_trpc.js";

export const syncStatusRouter = t.router({
  overview: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      taskId: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      const agents = repo.listAgents();
      const sessions = repo.listSessions();
      const activeSessions = sessions.filter(s =>
        s.status !== "COMPLETED" && s.status !== "CANCELLED"
      );

      // File claims
      const claims = input?.taskId
        ? fcListClaims({ taskId: input.taskId })
        : fcListClaims();

      // Conflicts
      const conflicts = fcDetectConflicts(input?.sessionId);

      // Active sync gates
      const gates = sgListActive(
        input?.sessionId || input?.taskId
          ? { sessionId: input?.sessionId, taskId: input?.taskId }
          : undefined
      );

      // All sync gates (for status view)
      const allGates = sgList(
        input?.sessionId || input?.taskId
          ? { sessionId: input?.sessionId, taskId: input?.taskId }
          : undefined
      );

      // Wake requests (queued)
      const wakeRequests = repo.listQueuedWakeRequests();

      // Agent work summary
      const agentSummary = agents.map(a => {
        const blocked = gates.some(g => {
          const required = g.requiredAgentIds?.split(",") ?? [];
          const acked = g.ackedAgentIds?.split(",").filter(Boolean) ?? [];
          return required.includes(a.id) && !acked.includes(a.id);
        });

        return {
          id: a.id,
          name: a.name,
          status: a.status,
          provider: a.provider,
          role: a.role,
          blocked,
          claimedFiles: claims
            .filter(c => c.agentId === a.id && c.status === "ACTIVE")
            .map(c => c.paths),
          pendingWakes: wakeRequests.filter(w => w.targetAgentId === a.id).length,
        };
      });

      return {
        agents: agentSummary,
        activeSessions: activeSessions.map(s => ({
          id: s.id,
          title: s.title,
          status: s.status,
          relationshipMode: (s as any).relationshipMode ?? "manager-delegate",
        })),
        claims: claims.filter(c => c.status === "ACTIVE"),
        conflicts,
        activeGates: gates.map(g => ({
          id: g.id,
          taskId: g.taskId,
          status: g.status,
          reason: g.reason,
          description: g.description,
          requiredAgentIds: g.requiredAgentIds,
          ackedAgentIds: g.ackedAgentIds,
        })),
        gateStats: {
          total: allGates.length,
          active: gates.length,
          resolved: allGates.filter(g => g.status === "READY_TO_CONTINUE").length,
          cancelled: allGates.filter(g => g.status === "CANCELLED").length,
        },
        pendingWakes: wakeRequests.length,
      };
    }),
});
