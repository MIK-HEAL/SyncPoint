import { computeContentHash, RealityProjection } from "syncpoint-context";
import { evaluateConstraints, ConstraintAction, ConstraintDecision } from "syncpoint-governance";
import { ResourceRef } from "syncpoint-kernel";
import {
  getContractForTask,
  getLatestCheckpointForAgent,
  getLatestContextSnapshot,
} from "../repositories/_exports/context-memory.js";
import { listQueuedWakeRequests } from "../repositories/_exports/orchestration.js";
import { resolveResourceRefs } from "./_resource-resolve.js";
import { buildProjection } from "./reality-projection-service.js";
import { rcDetectConflicts, rcList } from "./resource-claim-service.js";
import { sgCheckAgent, sgList, sgListActive } from "./sync-gate-service.js";
import { stxListActive } from "./checkpoint-review-service.js";
import { opList } from "./operation-service.js";

export interface ResumeProjectionContext {
  latestSnapshot: ReturnType<typeof getLatestContextSnapshot>;
  latestCheckpoint: ReturnType<typeof getLatestCheckpointForAgent>;
  contract: ReturnType<typeof getContractForTask>;
  workingResources: string[];
  touchedResources?: ResourceRef[];
  projection: RealityProjection;
}

export interface ExecutionReadinessInput {
  agentId: string;
  taskId: string;
  sessionId?: string;
  action: ConstraintAction;
  workingResources?: string[];
  touchedResources?: ResourceRef[];
  projection?: RealityProjection;
}

export interface ExecutionReadiness {
  blockCheck: ReturnType<typeof sgCheckAgent>;
  workingResources: string[];
  touchedResources?: ResourceRef[];
  projection: RealityProjection;
  constraintDecision: ConstraintDecision;
}

function toStringArray(value: string[] | string | undefined | null): string[] {
  if (Array.isArray(value)) {
    return value.map(item => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map(item => item.trim()).filter(Boolean);
  }
  return [];
}

export function prepareResumeProjectionContext(taskId: string, agentId: string): ResumeProjectionContext {
  const latestSnapshot = getLatestContextSnapshot(taskId, agentId);
  const latestCheckpoint = getLatestCheckpointForAgent(taskId, agentId);
  const contract = getContractForTask(taskId);
  const workingResources = toStringArray(latestSnapshot?.payload?.workingResources);
  const touchedResources = workingResources.length > 0
    ? resolveResourceRefs(workingResources, agentId)
    : undefined;
  const projection = buildProjection({
    taskId,
    workingResources,
    currentModules: [],
    snapshotId: latestSnapshot?.id,
    checkpointId: latestCheckpoint?.id,
    contractId: contract?.id,
    snapshotHash: latestSnapshot
      ? computeContentHash(latestSnapshot.summary, JSON.stringify(latestSnapshot.payload))
      : undefined,
    checkpointHash: latestCheckpoint
      ? computeContentHash(latestCheckpoint.summary, latestCheckpoint.progress)
      : undefined,
    contractHash: contract
      ? computeContentHash(
        contract.title,
        contract.scope,
        toStringArray(contract.responsibilities).join("|"),
        toStringArray(contract.interfaceSpec).join("|"),
        toStringArray(contract.resourceBoundaries).join("|"),
        contract.testPlan,
        contract.risks,
        contract.status,
      )
      : undefined,
  });

  return {
    latestSnapshot,
    latestCheckpoint,
    contract,
    workingResources,
    touchedResources,
    projection,
  };
}

export function checkAgentBlock(input: { agentId: string; taskId?: string; sessionId?: string }) {
  return sgCheckAgent(input.agentId, { taskId: input.taskId, sessionId: input.sessionId });
}

export function evaluateExecutionReadiness(input: ExecutionReadinessInput): ExecutionReadiness {
  const blockCheck = checkAgentBlock({
    agentId: input.agentId,
    taskId: input.taskId,
    sessionId: input.sessionId,
  });
  const workingResources = input.workingResources ?? toStringArray(getLatestContextSnapshot(input.taskId, input.agentId)?.payload?.workingResources);
  const touchedResources = input.touchedResources ?? (
    workingResources.length > 0
      ? resolveResourceRefs(workingResources, input.agentId)
      : undefined
  );
  const projection = input.projection ?? buildProjection({
    taskId: input.taskId,
    workingResources,
  });
  const constraintDecision = evaluateConstraints({
    action: input.action,
    projection,
    touchedResources,
  });

  return {
    blockCheck,
    workingResources,
    touchedResources,
    projection,
    constraintDecision,
  };
}

export function collectStatusSnapshotState(input?: { sessionId?: string }) {
  const scopeFilter = input?.sessionId ? { sessionId: input.sessionId } : undefined;
  const activeClaims = rcList(input?.sessionId ? { sessionId: input.sessionId } : undefined)
    .filter(claim => claim.status === "ACTIVE");

  return {
    activeClaims,
    conflicts: rcDetectConflicts(input?.sessionId ? { sessionId: input.sessionId } : undefined),
    activeGates: sgListActive(scopeFilter),
    allGates: sgList(scopeFilter),
    activeTransactions: stxListActive(scopeFilter),
    pendingOps: opList(input?.sessionId ? { sessionId: input.sessionId } : undefined).filter(op =>
      op.status === "DRAFT" || op.status === "SUBMITTED" || op.status === "APPROVED"
    ),
    wakeRequests: listQueuedWakeRequests(input?.sessionId),
  };
}

export const collaborationCoordinator = {
  resume: {
    prepareProjectionContext: prepareResumeProjectionContext,
  },
  execution: {
    checkAgentBlock,
    evaluateReadiness: evaluateExecutionReadiness,
  },
  status: {
    collectSnapshotState: collectStatusSnapshotState,
  },
} as const;
