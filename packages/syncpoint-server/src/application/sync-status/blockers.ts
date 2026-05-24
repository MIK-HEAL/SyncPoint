import { sgStatusDetailed } from "../sync-gate-service.js";

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
  activeGates: Array<{
    id: string;
    taskId: string;
    reason: string;
    description: string;
    status: string;
    requiredAgentIds: string[];
  }>;
  activeTransactions: Array<{
    id: string;
    taskId: string;
    checkpointId: string;
    requestingAgentId: string;
    status: string;
    requiredApproverIds: string[];
  }>;
  pendingHandoffs: Array<any>;
  pendingReviews: Array<any>;
  pendingOperations: Array<any>;
  agentName: (id: string) => string;
  taskTitle: (id: string) => string;
  statusAgentId?: string;
}): UnifiedBlocker[] {
  const blockers: UnifiedBlocker[] = [];

  for (const g of opts.activeGates) {
    const reqIds = g.requiredAgentIds ?? [];
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

  for (const tx of opts.activeTransactions) {
    const approverIds = tx.requiredApproverIds;
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

  const blockingOps = opts.pendingOperations.filter(op =>
    op.status === "SUBMITTED"
  );
  for (const op of blockingOps) {
    blockers.push({
      type: "operation",
      id: op.id,
      reason: "operation_awaiting_approval",
      description: `Operation \"${op.title}\" by ${opts.agentName(op.actorId)}`,
      requiredAgents: [{ id: "", name: "(approver)" }],
      status: op.status,
      relatedTaskId: op.taskId,
    });
  }

  return blockers;
}
