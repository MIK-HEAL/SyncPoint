/**
 * Sync Status Service — aggregation & read-model layer for the Editor Sync View (P9).
 *
 * All query aggregation, session scoping, blocker classification, and snapshot
 * assembly lives here.  The router is a thin transport adapter that delegates
 * to these functions.
 */

import * as repo from "../repositories.js";
import { sgListActive, sgList } from "./sync-gate-service.js";
import { isAgentBlocked } from "syncpoint-core";
import { fcListClaims, fcDetectConflicts } from "./file-claim-service.js";
import { stxListActive } from "./sync-transaction-service.js";
import { ppList } from "./patch-proposal-service.js";

// ── Shared helpers ──────────────────────────────────────

/** Build a gate/transaction scope filter from optional sessionId / taskId. */
export function buildScopeFilter(input?: { sessionId?: string; taskId?: string }) {
  return input?.sessionId || input?.taskId
    ? { sessionId: input?.sessionId, taskId: input?.taskId }
    : undefined;
}

/** Resolve a human-readable agent name from an id. */
function agentNameFromList(agents: Array<{ id: string; name: string }>, id: string): string {
  return agents.find(a => a.id === id)?.name ?? id.slice(0, 8);
}

/** Resolve a human-readable task title from an id. */
function taskTitleFromList(tasks: Array<{ id: string; title: string }>, id: string): string {
  return tasks.find(t => t.id === id)?.title ?? id.slice(0, 8);
}

// ── Blocker Classification ──────────────────────────────
//
// Centralised "what counts as a blocker" so that Sync View, playbook,
// wake engine, and future consumers share a single source of truth.

export interface UnifiedBlocker {
  type: string;
  id: string;
  reason: string;
  description: string;
  requiredAgents: Array<{ id: string; name: string }>;
  status: string;
  relatedTaskId?: string;
}

export function classifyBlockers(opts: {
  activeGates: ReturnType<typeof sgListActive>;
  activeTransactions: ReturnType<typeof stxListActive>;
  pendingHandoffs: Array<any>;
  pendingReviews: Array<any>;
  pendingPatches: Array<any>;
  agentName: (id: string) => string;
  taskTitle: (id: string) => string;
}): UnifiedBlocker[] {
  const blockers: UnifiedBlocker[] = [];

  // Sync Gates
  for (const g of opts.activeGates) {
    const reqIds = (g.requiredAgentIds || "").split(",").filter(Boolean);
    blockers.push({
      type: "sync_gate",
      id: g.id,
      reason: g.reason || "manual",
      description: g.description || "",
      requiredAgents: reqIds.map(id => ({ id, name: opts.agentName(id) })),
      status: g.status,
      relatedTaskId: g.taskId || undefined,
    });
  }

  // Sync Transactions
  for (const tx of opts.activeTransactions) {
    const approverIds = (tx.requiredApproverIds || "").split(",").filter(Boolean);
    blockers.push({
      type: "sync_transaction",
      id: tx.id,
      reason: "checkpoint_approval",
      description: `Tx by ${opts.agentName(tx.requestingAgentId)} — ${tx.status}`,
      requiredAgents: approverIds.map(id => ({ id, name: opts.agentName(id) })),
      status: tx.status,
      relatedTaskId: tx.taskId,
    });
  }

  // Pending Handoffs
  for (const h of opts.pendingHandoffs) {
    blockers.push({
      type: "handoff",
      id: h.id,
      reason: "handoff_pending",
      description: `${opts.agentName(h.fromAgentId)} → ${opts.agentName(h.toAgentId)}`,
      requiredAgents: [{ id: h.toAgentId, name: opts.agentName(h.toAgentId) }],
      status: h.status,
      relatedTaskId: h.taskId,
    });
  }

  // Pending Reviews
  for (const r of opts.pendingReviews) {
    blockers.push({
      type: "review",
      id: r.id,
      reason: r.status === "PENDING" ? "review_requested" : "review_in_progress",
      description: `Review on task ${opts.taskTitle(r.taskId)} by ${opts.agentName(r.reviewerAgentId)}`,
      requiredAgents: [{ id: r.reviewerAgentId, name: opts.agentName(r.reviewerAgentId) }],
      status: r.status,
      relatedTaskId: r.taskId,
    });
  }

  // Blocking Patches (SUBMITTED = awaiting approval, CONFLICTING = needs fix)
  const blockingPatches = opts.pendingPatches.filter(p =>
    p.status === "SUBMITTED" || p.status === "CONFLICTING"
  );
  for (const p of blockingPatches) {
    blockers.push({
      type: "patch_proposal",
      id: p.id,
      reason: p.status === "SUBMITTED" ? "patch_awaiting_approval" : "patch_conflict",
      description: `Patch "${p.title}" by ${opts.agentName(p.agentId)}`,
      requiredAgents: p.status === "SUBMITTED"
        ? [{ id: "", name: "(approver)" }]
        : [{ id: p.agentId, name: opts.agentName(p.agentId) }],
      status: p.status,
      relatedTaskId: p.taskId,
    });
  }

  return blockers;
}

// ── Overview (legacy) ───────────────────────────────────

export interface OverviewInput {
  sessionId?: string;
  taskId?: string;
}

export function buildOverview(input?: OverviewInput) {
  const agents = repo.listAgents();
  const sessions = repo.listSessions();
  const activeSessions = sessions.filter(s =>
    s.status !== "COMPLETED" && s.status !== "CANCELLED"
  );
  const claims = input?.taskId
    ? fcListClaims({ taskId: input.taskId })
    : fcListClaims();
  const conflicts = fcDetectConflicts(input?.sessionId);
  const scopeFilter = buildScopeFilter(input);
  const gates = sgListActive(scopeFilter);
  const allGates = sgList(scopeFilter);
  const wakeRequests = repo.listQueuedWakeRequests();
  const activeTransactions = stxListActive(scopeFilter);

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
}

// ── Snapshot (P9 comprehensive) ─────────────────────────

export interface SnapshotInput {
  sessionId?: string;
}

export function buildSnapshot(input?: SnapshotInput) {
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

  // ── name resolvers ──
  const agentName = (id: string) => agentNameFromList(agents, id);
  const taskTitle = (id: string) => taskTitleFromList(tasks, id);

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

  // ── 2. Agents ──
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
  const pendingReviews = allReviews.filter(r =>
    r.status === "PENDING" || r.status === "IN_PROGRESS"
  );
  const blockers = classifyBlockers({
    activeGates,
    activeTransactions,
    pendingHandoffs,
    pendingReviews,
    pendingPatches,
    agentName,
    taskTitle,
  });

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
}
