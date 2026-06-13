import { evaluateConstraints } from "syncpoint-governance";
import { isAgentBlocked } from "syncpoint-kernel";
import {
  listAgents,
  listEvents,
  listTasks,
} from "../../repositories/_exports/foundation.js";
import {
  getLatestContextSnapshot,
  listPendingHandoffs,
} from "../../repositories/_exports/context-memory.js";
import {
  listReviewRequests,
  listRoles,
  listSessions,
  listTaskAssignments,
} from "../../repositories/_exports/orchestration.js";
import { buildProjection } from "../reality-projection-service.js";
import { resolveResourceRefs } from "../_resource-resolve.js";
import { collaborationCoordinator } from "../collaboration-coordinator.js";
import { classifyBlockers } from "./blockers.js";
import { agentNameFromList, taskTitleFromList } from "./shared.js";

export interface SnapshotInput {
  sessionId?: string;
  agentId?: string;
  eventsLimit?: number;
}

export function buildSnapshot(input?: SnapshotInput) {
  const sessionId = input?.sessionId;

  const allSessions = listSessions();
  const activeSessions = allSessions.filter(s =>
    s.status !== "COMPLETED" && s.status !== "CANCELLED"
  );
  const scopedSessions = sessionId
    ? activeSessions.filter(s => s.id === sessionId)
    : activeSessions;

  const agents = listAgents();
  const tasks = listTasks();

  const { activeClaims, conflicts, activeGates, allGates, activeTransactions, pendingOps, wakeRequests } = collaborationCoordinator.status.collectSnapshotState({ sessionId });

  const allAssignments = scopedSessions.flatMap(s => listTaskAssignments(s.id));
  const allReviews = scopedSessions.flatMap(s => listReviewRequests(s.id));
  const scopedTaskIds = new Set(allAssignments.map(a => a.taskId));
  const pendingHandoffs = listPendingHandoffs().filter(h =>
    !sessionId || scopedTaskIds.has(h.taskId)
  );

  const agentName = (id: string) => agentNameFromList(agents, id);
  const taskTitle = (id: string) => taskTitleFromList(tasks, id);

  const sessionSection = scopedSessions.map(s => {
    const roles = listRoles(s.id);
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      relationshipMode: s.relationshipMode,
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
    const agentClaims = activeClaims.filter(c => c.actorId === a.id);
    const agentWakes = wakeRequests.filter(w => w.targetAgentId === a.id);

    let constraintBlocked = false;
    let constraintBlockerCount = 0;
    let constraintWarningCount = 0;
    if (agentAssignments.length > 0) {
      for (const ta of agentAssignments) {
        try {
          const snapshot = getLatestContextSnapshot(ta.taskId, a.id);
          let wr: string[] = [];
          if (snapshot) {
            wr = snapshot.payload?.workingResources ?? [];
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
        } catch {}
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

  const wakeSection = wakeRequests.map(w => ({
    id: w.id,
    targetAgentId: w.targetAgentId,
    targetAgentName: agentName(w.targetAgentId),
    sourceEvent: w.triggerEventType || "",
    reason: w.reason || "",
    status: w.status,
    createdAt: w.createdAt,
  }));

  const gateStats = {
    total: allGates.length,
    active: activeGates.length,
    resolved: allGates.filter(g => g.status === "READY_TO_CONTINUE").length,
    cancelled: allGates.filter(g => g.status === "CANCELLED").length,
  };
  const recentEvents = listEvents(input?.eventsLimit ?? 5);

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
