/**
 * P4D — Constraint Runtime Service (read-only visibility layer).
 *
 * Provides a unified query interface for constraint runtime decisions.
 * Does NOT mutate any state — purely read-only.
 *
 * Three responsibilities:
 *   1. Collect action context (resolve workingResources / touchedResources from DB).
 *   2. Build projection via buildProjection().
 *   3. Evaluate constraints via evaluateConstraints() and format output.
 *
 * Output contains only projected refs (sourceMemoryId, projectionId, rule,
 * message, evidence). Raw Project Memory content is never exposed.
 */

import {
  evaluateConstraints,
  buildConstraintManifest,
} from "syncpoint-core";
import type {
  ConstraintViolation,
  ConstraintManifest,
  ProjectionValidityStatus,
  ContextMode,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { buildProjection } from "./reality-projection-service.js";
import "./_scope-matchers.js";
import { resolveResourceRefs } from "./_resource-resolve.js";

// ── Types ────────────────────────────────────────────────

export type ConstraintCheckAction =
  | "resume"
  | "start_assignment"
  | "wake_start"
  | "operation_submit"
  | "operation_apply";

export interface ConstraintRuntimeCheckInput {
  action: ConstraintCheckAction;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  assignmentId?: string;
  wakeRequestId?: string;
  operationId?: string;
  contextMode?: ContextMode;
  touchedResources?: string[];
}

export interface ConstraintViolationView {
  rule: string;
  sourceMemoryId: string;
  projectionId: string;
  message: string;
  evidence?: string[];
}

export interface ConstraintRuntimeView {
  action: ConstraintCheckAction;
  permitted: boolean;
  blockers: ConstraintViolationView[];
  warnings: ConstraintViolationView[];
  projection: {
    projectionId: string;
    cacheKey: string;
    validity: ProjectionValidityStatus;
    memoryVersion: number;
    createdFrom: {
      taskId: string;
      snapshotId?: string;
      checkpointId?: string;
      contractId?: string;
    };
  };
  inputs: {
    taskId?: string;
    agentId?: string;
    sessionId?: string;
    workingResources: string[];
    touchedResources: string[];
    source: "context_snapshot" | "resource_claims" | "operation" | "explicit";
  };
  manifest?: ConstraintManifest;
  runtimeUnavailable?: {
    message: string;
  };
}

// ── Helpers ──────────────────────────────────────────────

function toView(v: ConstraintViolation): ConstraintViolationView {
  return {
    rule: v.rule,
    sourceMemoryId: v.sourceMemoryId,
    projectionId: v.projectionId,
    message: v.message,
    ...(v.evidence ? { evidence: v.evidence } : {}),
  };
}

function parseCsvFiles(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return csv.split(",").map(f => f.trim()).filter(Boolean);
}

function parsePayloadWorkingResources(snapshot: { payload?: { workingResources?: string[] } } | null | undefined): string[] {
  return snapshot?.payload?.workingResources ?? [];
}

// ── Input Resolution ─────────────────────────────────────

interface ResolvedInput {
  taskId: string;
  agentId?: string;
  sessionId?: string;
  workingResources: string[];
  touchedResources: string[];
  source: "context_snapshot" | "resource_claims" | "operation" | "explicit";
}

function resolveResumeInput(input: ConstraintRuntimeCheckInput): ResolvedInput {
  if (!input.taskId) throw new Error("taskId required for action 'resume'");
  if (!input.agentId) throw new Error("agentId required for action 'resume'");

  if (input.touchedResources?.length) {
    return {
      taskId: input.taskId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      workingResources: input.touchedResources,
      touchedResources: input.touchedResources,
      source: "explicit",
    };
  }

  const latestSnapshot = repo.getLatestContextSnapshot(input.taskId, input.agentId);
  const workingResources = parsePayloadWorkingResources(latestSnapshot);
  return {
    taskId: input.taskId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    workingResources,
    touchedResources: workingResources,
    source: "context_snapshot",
  };
}

function resolveStartAssignmentInput(input: ConstraintRuntimeCheckInput): ResolvedInput {
  if (!input.assignmentId) throw new Error("assignmentId required for action 'start_assignment'");

  const ta = repo.getTaskAssignment(input.assignmentId);

  if (input.touchedResources?.length) {
    return {
      taskId: ta.taskId,
      agentId: ta.assigneeAgentId,
      sessionId: ta.sessionId,
      workingResources: input.touchedResources,
      touchedResources: input.touchedResources,
      source: "explicit",
    };
  }

  const agentClaims = repo.listResourceClaims({ actorId: ta.assigneeAgentId, status: "ACTIVE" });
  const claimedLocators = agentClaims.flatMap(c => c.resources.map((r: any) => r.locator));
  return {
    taskId: ta.taskId,
    agentId: ta.assigneeAgentId,
    sessionId: ta.sessionId,
    workingResources: claimedLocators,
    touchedResources: claimedLocators,
    source: "resource_claims",
  };
}

function resolveWakeStartInput(input: ConstraintRuntimeCheckInput): ResolvedInput {
  let taskId: string;
  let agentId: string;
  let sessionId: string | undefined;

  if (input.wakeRequestId) {
    const wr = repo.getWakeRequest(input.wakeRequestId);
    taskId = wr.taskId ?? input.taskId ?? "";
    agentId = wr.targetAgentId;
    sessionId = wr.sessionId ?? input.sessionId;
  } else {
    if (!input.taskId) throw new Error("taskId or wakeRequestId required for action 'wake_start'");
    if (!input.agentId) throw new Error("agentId or wakeRequestId required for action 'wake_start'");
    taskId = input.taskId;
    agentId = input.agentId;
    sessionId = input.sessionId;
  }

  if (input.touchedResources?.length) {
    return {
      taskId,
      agentId,
      sessionId,
      workingResources: input.touchedResources,
      touchedResources: input.touchedResources,
      source: "explicit",
    };
  }

  const latestSnapshot = repo.getLatestContextSnapshot(taskId, agentId);
  const workingResources = parsePayloadWorkingResources(latestSnapshot);
  return {
    taskId,
    agentId,
    sessionId,
    workingResources,
    touchedResources: workingResources,
    source: "context_snapshot",
  };
}

function resolveOperationInput(input: ConstraintRuntimeCheckInput, action: "operation_submit" | "operation_apply"): ResolvedInput {
  if (!input.operationId) throw new Error(`operationId required for action '${action}'`);

  const op = repo.getOperation(input.operationId);

  if (input.touchedResources?.length) {
    return {
      taskId: op.taskId,
      agentId: op.actorId,
      sessionId: op.sessionId || undefined,
      workingResources: input.touchedResources,
      touchedResources: input.touchedResources,
      source: "explicit",
    };
  }

  const targetLocators = (op.targetResources ?? []).map((r: any) => r.locator).filter(Boolean);
  return {
    taskId: op.taskId,
    agentId: op.actorId,
    sessionId: op.sessionId || undefined,
    workingResources: targetLocators,
    touchedResources: targetLocators,
    source: "operation",
  };
}

function resolveInput(input: ConstraintRuntimeCheckInput): ResolvedInput {
  switch (input.action) {
    case "resume":
      return resolveResumeInput(input);
    case "start_assignment":
      return resolveStartAssignmentInput(input);
    case "wake_start":
      return resolveWakeStartInput(input);
    case "operation_submit":
    case "operation_apply":
      return resolveOperationInput(input, input.action);
    default:
      throw new Error(`Unknown action: ${input.action}`);
  }
}

// ── Main Entry Point ─────────────────────────────────────

/**
 * Evaluate constraint runtime for the given action context.
 * Read-only: never mutates task/wake/patch/assignment state.
 *
 * Returns a ConstraintRuntimeView with:
 *   - permitted: boolean
 *   - blockers/warnings: projected refs only (no raw PM content)
 *   - projection metadata
 *   - resolved input context
 */
export function constraintCheck(input: ConstraintRuntimeCheckInput): ConstraintRuntimeView {
  const resolved = resolveInput(input);

  // Attempt to build projection and evaluate constraints
  try {
    const projection = buildProjection({
      taskId: resolved.taskId,
      workingResources: resolved.workingResources,
    });

    const constraintInput = {
      action: input.action as any,
      projection,
      touchedResources: resolved.touchedResources.length > 0 && resolved.agentId
        ? resolveResourceRefs(resolved.touchedResources, resolved.agentId)
        : undefined,
    };
    const decision = evaluateConstraints(constraintInput);
    const manifest = buildConstraintManifest(constraintInput, decision);

    return {
      action: input.action,
      permitted: decision.permitted,
      blockers: decision.blockers.map(toView),
      warnings: decision.warnings.map(toView),
      manifest,
      projection: {
        projectionId: projection.projectionId,
        cacheKey: projection.cacheKey,
        validity: projection.projectionValidity,
        memoryVersion: projection.createdFrom.memoryVersion,
        createdFrom: {
          taskId: projection.createdFrom.taskId,
          snapshotId: projection.createdFrom.snapshotId,
          checkpointId: projection.createdFrom.checkpointId,
          contractId: projection.createdFrom.contractId,
        },
      },
      inputs: {
        taskId: resolved.taskId,
        agentId: resolved.agentId,
        sessionId: resolved.sessionId,
        workingResources: resolved.workingResources,
        touchedResources: resolved.touchedResources,
        source: resolved.source,
      },
    };
  } catch (err) {
    // Runtime unavailable — return a degraded but informative view
    const message = err instanceof Error ? err.message : String(err);
    return {
      action: input.action,
      permitted: true,
      blockers: [],
      warnings: [],
      projection: {
        projectionId: "",
        cacheKey: "",
        validity: "invalid",
        memoryVersion: 0,
        createdFrom: {
          taskId: resolved.taskId,
        },
      },
      inputs: {
        taskId: resolved.taskId,
        agentId: resolved.agentId,
        sessionId: resolved.sessionId,
        workingResources: resolved.workingResources,
        touchedResources: resolved.touchedResources,
        source: resolved.source,
      },
      runtimeUnavailable: { message },
    };
  }
}
