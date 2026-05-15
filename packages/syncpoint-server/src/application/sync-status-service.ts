/**
 * Sync Status Service — aggregation & read-model layer for the Editor Sync View (P9).
 *
 * All query aggregation, session scoping, blocker classification, and snapshot
 * assembly lives here.  The router is a thin transport adapter that delegates
 * to these functions.
 */

import * as repo from "../repositories.js";
import { sgListActive, sgList, sgStatusDetailed } from "./sync-gate-service.js";
import { isAgentBlocked, evaluateConstraints, parseGatePolicy, SyncGateStatus } from "syncpoint-core";
import { rcList, rcDetectConflicts } from "./resource-claim-service.js";
import { stxListActive } from "./checkpoint-review-service.js";
import { opList } from "./operation-service.js";
import { buildProjection } from "./reality-projection-service.js";
import { resolveResourceRefs } from "./_resource-resolve.js";

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
  gateDetails?: {
    policy: string;
    deadlineAt?: string;
    escalationAgentIds: string[];
    requiresHuman: boolean;
    pendingAgentIds: string[];
    ackedAgentIds: string[];
    requiredAgentIds: string[];
    voteCounts: Record<string, number>;
    eligibleVoterIds: string[];
    livenessPreview: {
      action: string;
      reason: string;
      escalateTo?: string[];
    };
    availableActions?: string[];
  };
}

export function classifyBlockers(opts: {
  activeGates: ReturnType<typeof sgListActive>;
  activeTransactions: ReturnType<typeof stxListActive>;
  pendingHandoffs: Array<any>;
  pendingReviews: Array<any>;
  pendingOperations: Array<any>;
  agentName: (id: string) => string;
  taskTitle: (id: string) => string;
  statusAgentId?: string;
}): UnifiedBlocker[] {
  const blockers: UnifiedBlocker[] = [];

  // Sync Gates
  for (const g of opts.activeGates) {
    const reqIds = (g.requiredAgentIds || "").split(",").filter(Boolean);
    const details = sgStatusDetailed(g.id, opts.statusAgentId);
    blockers.push({
      type: "sync_gate",
      id: g.id,
      reason: g.reason || "manual",
      description: g.description || "",
      requiredAgents: reqIds.map(id => ({ id, name: opts.agentName(id) })),
      status: g.status,
      relatedTaskId: g.taskId || undefined,
      gateDetails: {
        policy: details.policy.kind,
        deadlineAt: details.deadlineAt,
        escalationAgentIds: details.escalationAgentIds,
        requiresHuman: details.requiresHuman,
        pendingAgentIds: details.pendingAgentIds,
        ackedAgentIds: details.ackedAgentIds,
        requiredAgentIds: details.requiredAgentIds,
        voteCounts: details.voteCounts,
        eligibleVoterIds: details.eligibleVoterIds,
        livenessPreview: {
          action: details.livenessPreview.action,
          reason: details.livenessPreview.reason,
          escalateTo: details.livenessPreview.escalateTo,
        },
        availableActions: details.availableActions,
      },
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

  // Blocking Operations (SUBMITTED = awaiting approval)
  const blockingOps = opts.pendingOperations.filter(op =>
    op.status === "SUBMITTED"
  );
  for (const op of blockingOps) {
    blockers.push({
      type: "operation",
      id: op.id,
      reason: "operation_awaiting_approval",
      description: `Operation "${op.title}" by ${opts.agentName(op.actorId)}`,
      requiredAgents: [{ id: "", name: "(approver)" }],
      status: op.status,
      relatedTaskId: op.taskId,
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
  const claims = rcList(input?.taskId ? { taskId: input.taskId } : undefined);
  const conflicts = rcDetectConflicts(input?.sessionId ? { sessionId: input.sessionId } : undefined);
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
      claimedResources: claims
        .filter(c => c.actorId === a.id && c.status === "ACTIVE")
        .map(c => c.resources.map(r => `${r.type}:${r.locator}`).join(",")),
      pendingWakes: wakeRequests.filter(w => w.targetAgentId === a.id).length,
    })),
    activeSessions: activeSessions.map(s => ({
      id: s.id,
      title: s.title,
      status: s.status,
      relationshipMode: (s as any).relationshipMode ?? "manager-delegate",
    })),
    claims: claims.filter(c => c.status === "ACTIVE"),
    conflicts: conflicts.map(c => ({
      overlappingLocator: c.overlappingLocator,
      isHardConflict: c.isHardConflict,
      claimA: c.claimA,
      claimB: c.claimB,
    })),
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
  agentId?: string;
  eventsLimit?: number;
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

  // Scoped: claims, conflicts, gates, transactions, operations, wakes
  const activeClaims = rcList(sessionId ? { sessionId } : undefined)
    .filter(c => c.status === "ACTIVE");
  const conflicts = rcDetectConflicts(sessionId ? { sessionId } : undefined);
  const activeGates = sgListActive(scopeFilter);
  const allGates = sgList(scopeFilter);
  const activeTransactions = stxListActive(scopeFilter);
  const pendingOps = opList(sessionId ? { sessionId } : undefined).filter(op =>
    op.status === "DRAFT" || op.status === "SUBMITTED" || op.status === "APPROVED"
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
    const agentClaims = activeClaims.filter(c => c.actorId === a.id);
    const agentWakes = wakeRequests.filter(w => w.targetAgentId === a.id);

    // P4D: lightweight constraint visibility per agent
    let constraintBlocked = false;
    let constraintBlockerCount = 0;
    let constraintWarningCount = 0;
    if (agentAssignments.length > 0) {
      for (const ta of agentAssignments) {
        try {
          const snapshot = repo.getLatestContextSnapshot(ta.taskId, a.id);
          let wr: string[] = [];
          if (snapshot) {
            try { const p = JSON.parse(snapshot.payloadJson ?? "{}"); if (Array.isArray(p.workingResources)) wr = p.workingResources; } catch { /* ok */ }
          }
          const proj = buildProjection({ taskId: ta.taskId, workingResources: wr });
          const decision = evaluateConstraints({
            action: "resume",
            projection: proj,
            touchedResources: wr.length > 0
              ? resolveResourceRefs(wr, a.id)
              : undefined,
          });
          constraintBlockerCount += decision.blockers.length;
          constraintWarningCount += decision.warnings.length;
          if (!decision.permitted) constraintBlocked = true;
        } catch { /* projection unavailable — skip */ }
      }
    }

    return {
      id: a.id,
      name: a.name,
      status: a.status,
      provider: a.provider,
      role: a.role,
      blocked,
      blockingGateIds: scopedBlockingGates.map(g => g.id),
      constraintBlocked,
      constraintBlockerCount,
      constraintWarningCount,
      activeAssignments: agentAssignments.map(ta => ({
        id: ta.id,
        taskId: ta.taskId,
        taskTitle: taskTitle(ta.taskId),
        status: ta.status,
      })),
      claimedResources: agentClaims.map(c => ({
        claimId: c.id,
        resources: c.resources,
        mode: c.mode,
        taskId: c.taskId,
      })),
      pendingWakeCount: agentWakes.length,
    };
  });

  // ── 3. Resource Ownership ──
  const resourceSection = {
    activeClaims: activeClaims.map(c => ({
      id: c.id,
      actorId: c.actorId,
      actorName: agentName(c.actorId),
      taskId: c.taskId,
      taskTitle: taskTitle(c.taskId),
      resources: c.resources,
      mode: c.mode,
    })),
    conflicts: conflicts.map(c => ({
      overlappingLocator: c.overlappingLocator,
      isHardConflict: c.isHardConflict,
      claimA: { id: c.claimA.id, actorId: c.claimA.actorId, actorName: agentName(c.claimA.actorId), mode: c.claimA.mode },
      claimB: { id: c.claimB.id, actorId: c.claimB.actorId, actorName: agentName(c.claimB.actorId), mode: c.claimB.mode },
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
    pendingOperations: pendingOps,
    agentName,
    taskTitle,
    statusAgentId: input?.agentId,
  });

  // ── 5. Operation / Review Queue ──
  const operationSection = pendingOps.map(op => ({
    id: op.id,
    title: op.title,
    actorId: op.actorId,
    actorName: agentName(op.actorId),
    status: op.status,
    targetResources: op.targetResources,
    taskId: op.taskId,
    taskTitle: taskTitle(op.taskId),
    needsAction: op.status === "SUBMITTED" ? "approve_or_reject"
      : op.status === "APPROVED" ? "apply"
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
  const recentEvents = repo.listEvents(input?.eventsLimit ?? 5);

  return {
    timestamp: new Date().toISOString(),
    sessions: sessionSection,
    agents: agentSection,
    resourceOwnership: resourceSection,
    blockers,
    blockerCount: blockers.length,
    operations: operationSection,
    wakeQueue: wakeSection,
    recentEvents,
    gateStats,
    summary: {
      activeSessionCount: scopedSessions.length,
      agentCount: agents.length,
      blockedAgentCount: agentSection.filter(a => a.blocked).length,
      activeClaimCount: activeClaims.length,
      hardConflictCount: conflicts.filter(c => c.isHardConflict).length,
      pendingOperationCount: pendingOps.length,
      pendingWakeCount: wakeRequests.length,
      blockerCount: blockers.length,
      constraintBlockedAgents: agentSection.filter(a => a.constraintBlocked).length,
      constraintBlockedTasks: new Set(
        agentSection
          .filter(a => a.constraintBlocked)
          .flatMap(a => a.activeAssignments.map(ta => ta.taskId))
      ).size,
    },
  };
}
