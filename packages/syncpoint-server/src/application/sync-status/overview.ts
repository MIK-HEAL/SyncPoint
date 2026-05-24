import { isAgentBlocked } from "syncpoint-core";
import { listAgents } from "../../repositories/_exports/foundation.js";
import { listSessions } from "../../repositories/_exports/orchestration.js";
import { collaborationCoordinator } from "../collaboration-coordinator.js";

export interface OverviewInput {
  sessionId?: string;
  taskId?: string;
}

export function buildOverview(input?: OverviewInput) {
  const agents = listAgents();
  const sessions = listSessions();
  const activeSessions = sessions.filter(s =>
    s.status !== "COMPLETED" && s.status !== "CANCELLED"
  );
  const { claims, conflicts, gates, allGates, wakeRequests, activeTransactions } = collaborationCoordinator.status.collectOverviewState(input);

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
