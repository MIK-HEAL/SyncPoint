import {
  computeContentHash,
  evaluateConstraints,
  type ConstraintAction,
  type ConstraintDecision,
  type RealityProjection,
  type ResourceRef,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { resolveResourceRefs } from "./_resource-resolve.js";
import { buildProjection } from "./reality-projection-service.js";
import { rcDetectConflicts, rcList } from "./resource-claim-service.js";
import { sgCheckAgent, sgList, sgListActive } from "./sync-gate-service.js";
import { stxListActive } from "./checkpoint-review-service.js";
import { opList } from "./operation-service.js";

export interface ResumeProjectionContext {
  latestSnapshot: ReturnType<typeof repo.getLatestContextSnapshot>;
  latestCheckpoint: ReturnType<typeof repo.getLatestCheckpointForAgent>;
  contract: ReturnType<typeof repo.getContractForTask>;
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
  const latestSnapshot = repo.getLatestContextSnapshot(taskId, agentId);
  const latestCheckpoint = repo.getLatestCheckpointForAgent(taskId, agentId);
  const contract = repo.getContractForTask(taskId);
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
        toStringArray(contract.fileBoundaries).join("|"),
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

export function evaluateExecutionReadiness(input: ExecutionReadinessInput): ExecutionReadiness {
  const blockCheck = sgCheckAgent(input.agentId, { taskId: input.taskId, sessionId: input.sessionId });
  const workingResources = input.workingResources ?? toStringArray(repo.getLatestContextSnapshot(input.taskId, input.agentId)?.payload?.workingResources);
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

export function collectStatusOverviewState(input?: { sessionId?: string; taskId?: string }) {
  const scopeFilter = input?.sessionId || input?.taskId
    ? { sessionId: input?.sessionId, taskId: input?.taskId }
    : undefined;

  return {
    claims: rcList(input?.taskId ? { taskId: input.taskId } : undefined),
    conflicts: rcDetectConflicts(input?.sessionId ? { sessionId: input.sessionId } : undefined),
    gates: sgListActive(scopeFilter),
    allGates: sgList(scopeFilter),
    wakeRequests: repo.listQueuedWakeRequests(),
    activeTransactions: stxListActive(scopeFilter),
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
    wakeRequests: repo.listQueuedWakeRequests(input?.sessionId),
  };
}
