/**
 * P4D — Constraint Runtime Service (read-only visibility layer).
 *
 * Provides a unified query interface for constraint runtime decisions.
 * Does NOT mutate any state — purely read-only.
 *
 * Three responsibilities:
 *   1. Collect action context (resolve workingFiles / touchedFiles from DB).
 *   2. Build projection via buildProjection().
 *   3. Evaluate constraints via evaluateConstraints() and format output.
 *
 * Output contains only projected refs (sourceMemoryId, projectionId, rule,
 * message, evidence). Raw Project Memory content is never exposed.
 */

import {
  evaluateConstraints,
} from "syncpoint-core";
import type {
  ConstraintViolation,
  ProjectionValidityStatus,
  ContextMode,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { buildProjection } from "./projection-service.js";

// ── Types ────────────────────────────────────────────────

export type ConstraintCheckAction =
  | "resume"
  | "start_assignment"
  | "wake_start"
  | "patch_submit"
  | "patch_apply";

export interface ConstraintRuntimeCheckInput {
  action: ConstraintCheckAction;
  taskId?: string;
  agentId?: string;
  sessionId?: string;
  assignmentId?: string;
  wakeRequestId?: string;
  patchId?: string;
  contextMode?: ContextMode;
  touchedFiles?: string[];
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
      capsuleId?: string;
      checkpointId?: string;
      contractId?: string;
    };
  };
  inputs: {
    taskId?: string;
    agentId?: string;
    sessionId?: string;
    workingFiles: string[];
    touchedFiles: string[];
    source: "capsule" | "file_claims" | "patch" | "explicit";
  };
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

// ── Input Resolution ─────────────────────────────────────

interface ResolvedInput {
  taskId: string;
  agentId?: string;
  sessionId?: string;
  workingFiles: string[];
  touchedFiles: string[];
  source: "capsule" | "file_claims" | "patch" | "explicit";
}

function resolveResumeInput(input: ConstraintRuntimeCheckInput): ResolvedInput {
  if (!input.taskId) throw new Error("taskId required for action 'resume'");
  if (!input.agentId) throw new Error("agentId required for action 'resume'");

  if (input.touchedFiles?.length) {
    return {
      taskId: input.taskId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      workingFiles: input.touchedFiles,
      touchedFiles: input.touchedFiles,
      source: "explicit",
    };
  }

  const latestCapsule = repo.getLatestCapsule(input.taskId, input.agentId);
  const workingFiles = parseCsvFiles(latestCapsule?.workingFiles);
  return {
    taskId: input.taskId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    workingFiles,
    touchedFiles: workingFiles,
    source: "capsule",
  };
}

function resolveStartAssignmentInput(input: ConstraintRuntimeCheckInput): ResolvedInput {
  if (!input.assignmentId) throw new Error("assignmentId required for action 'start_assignment'");

  const ta = repo.getTaskAssignment(input.assignmentId);

  if (input.touchedFiles?.length) {
    return {
      taskId: ta.taskId,
      agentId: ta.assigneeAgentId,
      sessionId: ta.sessionId,
      workingFiles: input.touchedFiles,
      touchedFiles: input.touchedFiles,
      source: "explicit",
    };
  }

  const agentClaims = repo.listFileClaims({ agentId: ta.assigneeAgentId, status: "ACTIVE" });
  const claimedFiles = agentClaims.flatMap(c => parseCsvFiles(c.paths));
  return {
    taskId: ta.taskId,
    agentId: ta.assigneeAgentId,
    sessionId: ta.sessionId,
    workingFiles: claimedFiles,
    touchedFiles: claimedFiles,
    source: "file_claims",
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

  if (input.touchedFiles?.length) {
    return {
      taskId,
      agentId,
      sessionId,
      workingFiles: input.touchedFiles,
      touchedFiles: input.touchedFiles,
      source: "explicit",
    };
  }

  const latestCapsule = repo.getLatestCapsule(taskId, agentId);
  const workingFiles = parseCsvFiles(latestCapsule?.workingFiles);
  return {
    taskId,
    agentId,
    sessionId,
    workingFiles,
    touchedFiles: workingFiles,
    source: "capsule",
  };
}

function resolvePatchInput(input: ConstraintRuntimeCheckInput, action: "patch_submit" | "patch_apply"): ResolvedInput {
  if (!input.patchId) throw new Error(`patchId required for action '${action}'`);

  const proposal = repo.getPatchProposal(input.patchId);

  if (input.touchedFiles?.length) {
    return {
      taskId: proposal.taskId,
      agentId: proposal.agentId,
      sessionId: proposal.sessionId || undefined,
      workingFiles: input.touchedFiles,
      touchedFiles: input.touchedFiles,
      source: "explicit",
    };
  }

  const touchedFiles = parseCsvFiles(proposal.touchedFiles);
  return {
    taskId: proposal.taskId,
    agentId: proposal.agentId,
    sessionId: proposal.sessionId || undefined,
    workingFiles: touchedFiles,
    touchedFiles: touchedFiles,
    source: "patch",
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
    case "patch_submit":
    case "patch_apply":
      return resolvePatchInput(input, input.action);
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
      workingFiles: resolved.workingFiles,
    });

    const decision = evaluateConstraints({
      action: input.action,
      projection,
      touchedFiles: resolved.touchedFiles.length > 0 ? resolved.touchedFiles : undefined,
    });

    return {
      action: input.action,
      permitted: decision.permitted,
      blockers: decision.blockers.map(toView),
      warnings: decision.warnings.map(toView),
      projection: {
        projectionId: projection.projectionId,
        cacheKey: projection.cacheKey,
        validity: projection.projectionValidity,
        memoryVersion: projection.createdFrom.memoryVersion,
        createdFrom: {
          taskId: projection.createdFrom.taskId,
          capsuleId: projection.createdFrom.capsuleId,
          checkpointId: projection.createdFrom.checkpointId,
          contractId: projection.createdFrom.contractId,
        },
      },
      inputs: {
        taskId: resolved.taskId,
        agentId: resolved.agentId,
        sessionId: resolved.sessionId,
        workingFiles: resolved.workingFiles,
        touchedFiles: resolved.touchedFiles,
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
        workingFiles: resolved.workingFiles,
        touchedFiles: resolved.touchedFiles,
        source: resolved.source,
      },
      runtimeUnavailable: { message },
    };
  }
}
