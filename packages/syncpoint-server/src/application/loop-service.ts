/**
 * Loop orchestration use cases.
 * These are the composite workflows that CLI, MCP, and tRPC all share.
 * Transport layers (CLI/MCP/router) handle I/O; this module handles logic.
 */

import {
  TaskStatus,
  buildAdapterInstruction,
  formatResumePrompt,
} from "syncpoint-core";
import type { AdapterLifecycleEvent, AgentProvider, PromptFormat, ResumeContext } from "syncpoint-core";
import * as repo from "../repositories.js";
import { sgCheckAgent } from "./sync-gate-service.js";

// ── Types ────────────────────────────────────────────

export interface LoopBootInput {
  agentId: string;
  taskId: string;
  provider?: string;
}

export interface LoopBootResult {
  ok: true;
  taskId: string;
  agentId: string;
  provider: string;
  taskStatus: string;
  contextReady: boolean;
  filesWritten: string[];
  files: Record<string, string>;
  warnings: string[];
}

export interface LoopResumeInput {
  agentId: string;
  taskId: string;
  provider?: string;
  format?: PromptFormat;
}

export interface LoopResumeResult {
  ok: true;
  taskId: string;
  agentId: string;
  provider: string;
  contextReady: boolean;
  filesWritten: string[];
  files: Record<string, string>;
  prompt: string;
}

export interface LoopCheckpointInput {
  agentId: string;
  taskId: string;
  summary: string;
  progress?: string;
  nextSteps?: string;
  risks?: string;
  blockers?: string;
  goal?: string;
  phase?: string;
  completed?: string;
  remaining?: string;
  workingFiles?: string;
  resumePrompt?: string;
  needSync?: boolean;
  provider?: string;
}

export interface LoopCheckpointResult {
  ok: true;
  taskId: string;
  agentId: string;
  checkpointId: string;
  capsuleId: string;
  needSync: boolean;
  filesWritten: string[];
  files: Record<string, string>;
}

export interface LoopHandoffInput {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  context: string;
  autoAccept?: boolean;
  provider?: string;
}

export interface LoopHandoffResult {
  ok: true;
  taskId: string;
  handoffId: string;
  from: string;
  to: string;
  accepted: boolean;
  filesWritten: string[];
  files: Record<string, string>;
}

export interface LoopStatusInput {
  agentId: string;
  taskId?: string;
}

export interface LoopStatusResult {
  ok: true;
  agentId: string;
  agentName: string;
  agentStatus: string;
  hasTask: boolean;
  taskId?: string;
  taskTitle?: string;
  taskStatus?: string;
  contractStatus?: string | null;
  checkpointCount?: number;
  hasCapsule?: boolean;
  contextReady?: boolean;
  warnings?: string[];
}

// ── Exit code errors ─────────────────────────────────

export const EXIT = {
  OK: 0,
  ERROR: 1,
  CONTEXT_POLICY: 2,
  CONTRACT_MISSING: 3,
  STATE_INVALID: 4,
} as const;

export class LoopError extends Error {
  constructor(public readonly exitCode: number, message: string) {
    super(message);
    this.name = "LoopError";
  }
}

// ── Use Cases ────────────────────────────────────────

export function loopBoot(input: LoopBootInput): LoopBootResult {
  const agent = repo.getAgent(input.agentId);
  const task = repo.getTask(input.taskId);

  // 1. Ensure task assigned to this agent
  if (task.ownerAgentId !== agent.id) {
    if (task.status === "OPEN") {
      repo.assignTask(task.id, agent.id);
    } else if (task.ownerAgentId && task.ownerAgentId !== agent.id) {
      throw new LoopError(EXIT.STATE_INVALID, `Task ${task.id} is assigned to ${task.ownerAgentId}, not ${agent.id}`);
    }
  }

  // 2. Advance task to IN_PROGRESS if possible
  const freshTask = repo.getTask(task.id);
  if (freshTask.status === "ASSIGNED" || freshTask.status === "READY_TO_WORK") {
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
  }

  // 3. Enforce context policy (non-blocking for boot)
  const policy = repo.enforceContextPolicy(task.id, agent.id);

  // 4. Generate adapter files
  const ctx = repo.getResumeContext(task.id, agent.id);
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "boot" as AdapterLifecycleEvent);

  return {
    ok: true,
    taskId: task.id,
    agentId: agent.id,
    provider: instruction.provider,
    taskStatus: repo.getTask(task.id).status,
    contextReady: ctx.ready,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
    warnings: ctx.warnings,
  };
}

export function loopResume(input: LoopResumeInput): LoopResumeResult {
  const agent = repo.getAgent(input.agentId);
  const task = repo.getTask(input.taskId);

  // 0. SyncGate hard gate — block resume if agent has unacknowledged gates
  const blockCheck = sgCheckAgent(agent.id, { taskId: task.id });
  if (blockCheck.blocked) {
    const gateIds = blockCheck.blockingGates.map(g => g.id).join(", ");
    throw new LoopError(EXIT.STATE_INVALID, `Agent blocked by sync gate(s): ${gateIds}. Acknowledge before resuming.`);
  }

  // 1. Enforce context policy (hard gate)
  const policy = repo.enforceContextPolicy(task.id, agent.id);
  if (!policy.ready) {
    throw new LoopError(EXIT.CONTEXT_POLICY, `Context not ready: ${policy.warnings.join("; ")}`);
  }

  // 2. Ensure task is IN_PROGRESS
  const freshTask = repo.getTask(task.id);
  if (freshTask.status === "READY_TO_WORK" || freshTask.status === "NEEDS_SYNC") {
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
  }

  // 3. Generate adapter files
  const ctx = repo.getResumeContext(task.id, agent.id);
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "resume" as AdapterLifecycleEvent);

  // 4. Format prompt
  const format = input.format ?? "system-prompt";
  const prompt = formatResumePrompt(ctx, format);

  return {
    ok: true,
    taskId: task.id,
    agentId: agent.id,
    provider: instruction.provider,
    contextReady: ctx.ready,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
    prompt,
  };
}

export function loopCheckpoint(input: LoopCheckpointInput): LoopCheckpointResult {
  const agent = repo.getAgent(input.agentId);
  const task = repo.getTask(input.taskId);

  // 1. Create checkpoint
  const cp = repo.createCheckpoint({
    taskId: task.id,
    agentId: agent.id,
    summary: input.summary,
    progress: input.progress ?? "",
    currentUnderstanding: "",
    changedFiles: "",
    risks: input.risks ?? "",
    blockers: input.blockers ?? "",
    nextSteps: input.nextSteps ?? "",
    needSync: input.needSync ?? false,
  });

  // 2. Create capsule (inherit from latest if not specified)
  const latestCapsule = repo.getLatestCapsule(task.id, agent.id);
  const capsule = repo.createCapsule({
    taskId: task.id,
    agentId: agent.id,
    checkpointId: cp.id,
    goal: input.goal || (latestCapsule?.goal ?? ""),
    currentPhase: input.phase || (latestCapsule?.currentPhase ?? ""),
    confirmedDecisions: latestCapsule?.confirmedDecisions ?? "",
    interfaceContract: latestCapsule?.interfaceContract ?? "",
    workingFiles: input.workingFiles || (latestCapsule?.workingFiles ?? ""),
    completedWork: input.completed || "",
    remainingWork: input.remaining || "",
    risks: input.risks ?? "",
    blockers: input.blockers ?? "",
    nextSteps: input.nextSteps ?? "",
    resumePrompt: input.resumePrompt || input.summary,
  });

  // 3. Handle needSync flag
  if (input.needSync && task.status === "IN_PROGRESS") {
    repo.updateTaskStatus(task.id, TaskStatus.NEEDS_SYNC);
  }

  // 4. Refresh adapter files
  const ctx = repo.getResumeContext(task.id, agent.id);
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "checkpoint" as AdapterLifecycleEvent);

  return {
    ok: true,
    taskId: task.id,
    agentId: agent.id,
    checkpointId: cp.id,
    capsuleId: capsule.id,
    needSync: input.needSync ?? false,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
  };
}

export function loopHandoff(input: LoopHandoffInput): LoopHandoffResult {
  const fromAgent = repo.getAgent(input.fromAgentId);
  const toAgent = repo.getAgent(input.toAgentId);
  const task = repo.getTask(input.taskId);

  // 1. Save sender's final checkpoint + capsule
  const cp = repo.createCheckpoint({
    taskId: task.id,
    agentId: fromAgent.id,
    summary: `Handoff to ${toAgent.name}: ${input.context}`,
    progress: "",
    currentUnderstanding: "",
    changedFiles: "",
    risks: "",
    blockers: "",
    nextSteps: `Handoff to ${toAgent.name}`,
    needSync: false,
  });

  const latestCapsule = repo.getLatestCapsule(task.id, fromAgent.id);
  repo.createCapsule({
    taskId: task.id,
    agentId: fromAgent.id,
    checkpointId: cp.id,
    goal: latestCapsule?.goal ?? "",
    currentPhase: "handoff",
    confirmedDecisions: latestCapsule?.confirmedDecisions ?? "",
    interfaceContract: latestCapsule?.interfaceContract ?? "",
    workingFiles: latestCapsule?.workingFiles ?? "",
    completedWork: latestCapsule?.completedWork ?? "",
    remainingWork: latestCapsule?.remainingWork ?? "",
    risks: latestCapsule?.risks ?? "",
    blockers: latestCapsule?.blockers ?? "",
    nextSteps: `Handoff to ${toAgent.name}: ${input.context}`,
    resumePrompt: input.context,
  });

  // 2. Create handoff
  const handoff = repo.createHandoff({
    taskId: task.id,
    fromAgentId: fromAgent.id,
    toAgentId: toAgent.id,
    contextSummary: input.context,
  });

  let accepted = false;
  if (input.autoAccept) {
    repo.acceptHandoff(handoff.id);
    accepted = true;
  }

  // 3. Generate adapter files for receiver
  const ctx = repo.getResumeContext(task.id, toAgent.id);
  const provider = input.provider ?? toAgent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "handoff" as AdapterLifecycleEvent);

  return {
    ok: true,
    taskId: task.id,
    handoffId: handoff.id,
    from: fromAgent.id,
    to: toAgent.id,
    accepted,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
  };
}

export function loopStatus(input: LoopStatusInput): LoopStatusResult {
  const agent = repo.getAgent(input.agentId);
  const taskId = input.taskId ?? agent.currentTaskId;

  if (!taskId) {
    return {
      ok: true,
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      hasTask: false,
    };
  }

  const task = repo.getTask(taskId);
  const contract = repo.getContractForTask(taskId);
  const latestCapsule = repo.getLatestCapsule(taskId, agent.id);
  const checkpoints = repo.listCheckpoints(taskId);
  const policy = repo.enforceContextPolicy(taskId, agent.id);

  return {
    ok: true,
    agentId: agent.id,
    agentName: agent.name,
    agentStatus: agent.status,
    hasTask: true,
    taskId: task.id,
    taskTitle: task.title,
    taskStatus: task.status,
    contractStatus: contract?.status ?? null,
    checkpointCount: checkpoints.length,
    hasCapsule: !!latestCapsule,
    contextReady: policy.ready,
    warnings: policy.warnings,
  };
}
