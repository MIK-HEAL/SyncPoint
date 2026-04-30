/**
 * Sync Status Router — unified sync state for Editor Sync View (P9).
 *
 * Two endpoints:
 *   overview  — legacy compact summary (backward-compatible)
 *   snapshot  — comprehensive sync map for the VS Code Sync View
 */
import { z } from "zod";
import * as repo from "../repositories.js";
import { sgListActive, sgList } from "../application/sync-gate-service.js";
import { isAgentBlocked } from "syncpoint-core";
import { fcListClaims, fcDetectConflicts } from "../application/file-claim-service.js";
import { stxListActive } from "../application/sync-transaction-service.js";
import { ppList } from "../application/patch-proposal-service.js";
import { t, publicProcedure } from "./_trpc.js";

// ── helpers ──────────────────────────────────────────

function gateFilter(input?: { sessionId?: string; taskId?: string }) {
  return input?.sessionId || input?.taskId
    ? { sessionId: input?.sessionId, taskId: input?.taskId }
    : undefined;
}

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
    .query(({ input }) => {
      const agents = repo.listAgents();
      const sessions = repo.listSessions();
      const activeSessions = sessions.filter(s =>
        s.status !== "COMPLETED" && s.status !== "CANCELLED"
      );
      const claims = input?.taskId
        ? fcListClaims({ taskId: input.taskId })
        : fcListClaims();
      const conflicts = fcDetectConflicts(input?.sessionId);
      const gates = sgListActive(gateFilter(input));
      const allGates = sgList(gateFilter(input));
      const wakeRequests = repo.listQueuedWakeRequests();
      const activeTransactions = stxListActive(gateFilter(input));

      return {
        agents: agents.map(a => ({
          id: a.id,
          name: a.name,
          status: a.status,
          provider: a.provider,
          role: a.role,
          blocked: gates.some(g => isAgentBlocked(g, a.id)),
          claimedFiles: claims
            .filter(c => c.agentId === a.id && c.status === "ACTIVE")
            .map(c => c.paths),
          pendingWakes: wakeRequests.filter(w => w.targetAgentId === a.id).length,
        })),
        activeSessions: activeSessions.map(s => ({
          id: s.id,
          title: s.title,
          status: s.status,
          relationshipMode: (s as any).relationshipMode ?? "manager-delegate",
        })),
        claims: claims.filter(c => c.status === "ACTIVE"),
        conflicts,
        activeGates: gates.map(g => ({
          id: g.id, taskId: g.taskId, status: g.status,
          reason: g.reason, description: g.description,
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
        activeTransactions: activeTransactions.map(tx => ({
          id: tx.id, taskId: tx.taskId, checkpointId: tx.checkpointId,
          requestingAgentId: tx.requestingAgentId, status: tx.status,
          requiredApproverIds: tx.requiredApproverIds,
          approvedByIds: tx.approvedByIds,
          rejectedByIds: tx.rejectedByIds,
          gateId: tx.gateId,
        })),
      };
    }),

  /**
   * P9 Snapshot — comprehensive sync map for the Editor Sync View.
   *
   * Sections:
   *   1. sessions    — active sessions with relationship mode & role info
   *   2. agents      — each agent's task, status, blocked state, claims
   *   3. fileOwnership — active claims, conflicts, exclusive/shared breakdown
   *   4. blockers    — every pending gate, transaction, handoff, review
   *   5. patches     — patch proposals awaiting action
   *   6. wakeQueue   — wake requests with semantic origin
   */
  snapshot: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      const sessionId = input?.sessionId;
      const scopeFilter = sessionId ? { sessionId } : undefined;

      // ── raw data (scoped by sessionId when provided) ──
      const allSessions = repo.listSessions();
      const activeSessions = allSessions.filter(s =>
        s.status !== "COMPLETED" && s.status !== "CANCELLED"
      );
      const scopedSessions = sessionId
        ? activeSessions.filter(s => s.id === sessionId)
        : activeSessions;

      const agents = repo.listAgents();
      const tasks = repo.listTasks();

      // Scoped: claims, conflicts, gates, transactions, patches, wakes
      const activeClaims = fcListClaims(sessionId ? { sessionId } : undefined)
        .filter(c => c.status === "ACTIVE");
      const conflicts = fcDetectConflicts(sessionId);
      const activeGates = sgListActive(scopeFilter);
      const allGates = sgList(scopeFilter);
      const activeTransactions = stxListActive(scopeFilter);
      const pendingPatches = ppList(sessionId ? { sessionId } : undefined).filter(p =>
        p.status === "DRAFT" || p.status === "SUBMITTED" || p.status === "CONFLICTING" || p.status === "APPROVED"
      );
      const wakeRequests = repo.listQueuedWakeRequests(sessionId);

      // Scoped: assignments, reviews, handoffs
      const allAssignments = scopedSessions.flatMap(s => repo.listTaskAssignments(s.id));
      const allReviews = scopedSessions.flatMap(s => repo.listReviewRequests(s.id));
      const scopedTaskIds = new Set(allAssignments.map(a => a.taskId));
      const pendingHandoffs = repo.listPendingHandoffs().filter(h =>
        !sessionId || scopedTaskIds.has(h.taskId)
      );

      // ── helpers ──
      const agentName = (id: string) => agents.find(a => a.id === id)?.name ?? id.slice(0, 8);
      const taskTitle = (id: string) => tasks.find(t => t.id === id)?.title ?? id.slice(0, 8);

      // ── 1. Sessions ──
      const sessionSection = scopedSessions.map(s => {
        const roles = repo.listRoles(s.id);
        return {
          id: s.id,
          title: s.title,
          status: s.status,
          relationshipMode: (s as any).relationshipMode ?? "manager-delegate",
          agents: roles.map(r => ({
            agentId: r.agentId,
            agentName: agentName(r.agentId),
            role: r.role,
          })),
        };
      });

      const agentSection = agents.map(a => {
        const agentAssignments = allAssignments.filter(
          ta => ta.assigneeAgentId === a.id &&
          ta.status !== "COMPLETED" && ta.status !== "CANCELLED"
        );
        const scopedBlockingGates = activeGates.filter(g => isAgentBlocked(g, a.id));
        const blocked = scopedBlockingGates.length > 0;
        const agentClaims = activeClaims.filter(c => c.agentId === a.id);
        const agentWakes = wakeRequests.filter(w => w.targetAgentId === a.id);

        return {
          id: a.id,
          name: a.name,
          status: a.status,
          provider: a.provider,
          role: a.role,
          blocked,
          blockingGateIds: scopedBlockingGates.map(g => g.id),
          activeAssignments: agentAssignments.map(ta => ({
            id: ta.id,
            taskId: ta.taskId,
            taskTitle: taskTitle(ta.taskId),
            status: ta.status,
          })),
          claimedFiles: agentClaims.map(c => ({
            claimId: c.id,
            paths: c.paths,
            mode: c.mode,
            taskId: c.taskId,
          })),
          pendingWakeCount: agentWakes.length,
        };
      });

      // ── 3. File Ownership ──
      const fileSection = {
        activeClaims: activeClaims.map(c => ({
          id: c.id,
          agentId: c.agentId,
          agentName: agentName(c.agentId),
          taskId: c.taskId,
          taskTitle: taskTitle(c.taskId),
          paths: c.paths,
          mode: c.mode,
        })),
        conflicts: conflicts.map(c => ({
          overlappingPath: c.overlappingPath,
          isHardConflict: c.isHardConflict,
          claimA: { id: c.claimA.id, agentId: c.claimA.agentId, agentName: agentName(c.claimA.agentId), mode: c.claimA.mode },
          claimB: { id: c.claimB.id, agentId: c.claimB.agentId, agentName: agentName(c.claimB.agentId), mode: c.claimB.mode },
        })),
        stats: {
          totalClaims: activeClaims.length,
          exclusiveClaims: activeClaims.filter(c => c.mode === "exclusive").length,
          sharedClaims: activeClaims.filter(c => c.mode === "shared").length,
          hardConflicts: conflicts.filter(c => c.isHardConflict).length,
          softConflicts: conflicts.filter(c => !c.isHardConflict).length,
        },
      };

      // ── 4. Sync Blockers (unified) ──
      const blockers: Array<{
        type: string;
        id: string;
        reason: string;
        description: string;
        requiredAgents: Array<{ id: string; name: string }>;
        status: string;
        relatedTaskId?: string;
      }> = [];

      // Sync Gates
      for (const g of activeGates) {
        const reqIds = (g.requiredAgentIds || "").split(",").filter(Boolean);
        blockers.push({
          type: "sync_gate",
          id: g.id,
          reason: g.reason || "manual",
          description: g.description || "",
          requiredAgents: reqIds.map(id => ({ id, name: agentName(id) })),
          status: g.status,
          relatedTaskId: g.taskId || undefined,
        });
      }

      // Sync Transactions
      for (const tx of activeTransactions) {
        const approverIds = (tx.requiredApproverIds || "").split(",").filter(Boolean);
        blockers.push({
          type: "sync_transaction",
          id: tx.id,
          reason: "checkpoint_approval",
          description: `Tx by ${agentName(tx.requestingAgentId)} — ${tx.status}`,
          requiredAgents: approverIds.map(id => ({ id, name: agentName(id) })),
          status: tx.status,
          relatedTaskId: tx.taskId,
        });
      }

      // Pending Handoffs
      for (const h of pendingHandoffs) {
        blockers.push({
          type: "handoff",
          id: h.id,
          reason: "handoff_pending",
          description: `${agentName(h.fromAgentId)} → ${agentName(h.toAgentId)}`,
          requiredAgents: [{ id: h.toAgentId, name: agentName(h.toAgentId) }],
          status: h.status,
          relatedTaskId: h.taskId,
        });
      }

      // Pending Reviews
      const pendingReviews = allReviews.filter(r =>
        r.status === "PENDING" || r.status === "IN_PROGRESS"
      );
      for (const r of pendingReviews) {
        blockers.push({
          type: "review",
          id: r.id,
          reason: r.status === "PENDING" ? "review_requested" : "review_in_progress",
          description: `Review on task ${taskTitle(r.taskId)} by ${agentName(r.reviewerAgentId)}`,
          requiredAgents: [{ id: r.reviewerAgentId, name: agentName(r.reviewerAgentId) }],
          status: r.status,
          relatedTaskId: r.taskId,
        });
      }

      // Blocking Patches (SUBMITTED = awaiting approval, CONFLICTING = needs fix)
      const blockingPatches = pendingPatches.filter(p =>
        p.status === "SUBMITTED" || p.status === "CONFLICTING"
      );
      for (const p of blockingPatches) {
        blockers.push({
          type: "patch_proposal",
          id: p.id,
          reason: p.status === "SUBMITTED" ? "patch_awaiting_approval" : "patch_conflict",
          description: `Patch "${p.title}" by ${agentName(p.agentId)}`,
          requiredAgents: p.status === "SUBMITTED"
            ? [{ id: "", name: "(approver)" }]
            : [{ id: p.agentId, name: agentName(p.agentId) }],
          status: p.status,
          relatedTaskId: p.taskId,
        });
      }

      // ── 5. Patch / Review Queue ──
      const patchSection = pendingPatches.map(p => ({
        id: p.id,
        title: p.title,
        agentId: p.agentId,
        agentName: agentName(p.agentId),
        status: p.status,
        touchedFiles: p.touchedFiles || "",
        taskId: p.taskId,
        taskTitle: taskTitle(p.taskId),
        needsAction: p.status === "SUBMITTED" ? "approve_or_reject"
          : p.status === "APPROVED" ? "apply"
          : p.status === "CONFLICTING" ? "fix_and_resubmit"
          : "submit",
      }));

      // ── 6. Wake Queue ──
      const wakeSection = wakeRequests.map(w => ({
        id: w.id,
        targetAgentId: w.targetAgentId,
        targetAgentName: agentName(w.targetAgentId),
        sourceEvent: w.triggerEventType || "",
        reason: w.reason || "",
        status: w.status,
        createdAt: w.createdAt,
      }));

      // ── Gate stats ──
      const gateStats = {
        total: allGates.length,
        active: activeGates.length,
        resolved: allGates.filter(g => g.status === "READY_TO_CONTINUE").length,
        cancelled: allGates.filter(g => g.status === "CANCELLED").length,
      };

      return {
        timestamp: new Date().toISOString(),
        sessions: sessionSection,
        agents: agentSection,
        fileOwnership: fileSection,
        blockers,
        blockerCount: blockers.length,
        patches: patchSection,
        wakeQueue: wakeSection,
        gateStats,
        summary: {
          activeSessionCount: scopedSessions.length,
          agentCount: agents.length,
          blockedAgentCount: agentSection.filter(a => a.blocked).length,
          activeClaimCount: activeClaims.length,
          hardConflictCount: conflicts.filter(c => c.isHardConflict).length,
          pendingPatchCount: pendingPatches.length,
          pendingWakeCount: wakeRequests.length,
          blockerCount: blockers.length,
        },
      };
    }),
});
