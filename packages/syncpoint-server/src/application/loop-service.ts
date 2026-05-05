/**
 * Loop orchestration use cases.
 * These are the composite workflows that CLI, MCP, and tRPC all share.
 * Transport layers (CLI/MCP/router) handle I/O; this module handles logic.
 */

import {
  TaskStatus,
  buildAdapterInstruction,
  formatResumePrompt,
  DEFAULT_CONTEXT_MODE,
  evaluateConstraints,
  computeContentHash,
} from "syncpoint-core";
import type { AdapterLifecycleEvent, AgentProvider, PromptFormat, ResumeContext, ContextMode } from "syncpoint-core";
import * as repo from "../repositories.js";
import { sgCheckAgent } from "./sync-gate-service.js";
import { assembleProtocolGate, injectProjectionIntoGate, validateCapsule, formatProtocolGatePrompt, formatCapsuleReality, formatValidationNotes } from "./protocol-gate-service.js";
import { buildProjection } from "./projection-service.js";
import type { ProjectedReality } from "syncpoint-core";
import "./_scope-matchers.js";
import "./_plugin-init.js";
import { resolveResourceRefs } from "./_resource-resolve.js";

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
  contextMode?: ContextMode;
  sessionId?: string;
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
  contextMode: string;
  protocolGateBlocked: boolean;
  capsuleValid: boolean;
  validationNotes: string[];
  constraintWarnings: string[];
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
  workingResources?: string;
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
  //    P3B: strip raw projectMemories — agent sees projected reality only.
  const ctx = repo.getResumeContext(task.id, agent.id);
  ctx.projectMemories = [];
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
  const mode: ContextMode = input.contextMode ?? DEFAULT_CONTEXT_MODE;

  // 0. Protocol Gate — assemble all collaboration rules
  let protocolGate = assembleProtocolGate(agent.id, task.id, input.sessionId);

  // 0a. SyncGate hard gate — block resume if agent has unacknowledged gates
  const blockCheck = sgCheckAgent(agent.id, { taskId: task.id });
  if (blockCheck.blocked) {
    const gateIds = blockCheck.blockingGates.map(g => g.id).join(", ");
    throw new LoopError(EXIT.STATE_INVALID, `Agent blocked by sync gate(s): ${gateIds}. Acknowledge before resuming.`);
  }

  // 0b. P3B — Build projection and inject into gate
  //     workingResources come from latest capsule if available
  const latestCapsule = repo.getLatestCapsule(task.id, agent.id);
  const capsuleWorkingResources = latestCapsule?.workingResources
    ? latestCapsule.workingResources.split(",").map((f: string) => f.trim()).filter(Boolean)
    : [];
  const latestCheckpoint = repo.getLatestCheckpointForAgent(task.id, agent.id);
  const contract = repo.getContractForTask(task.id);
  const projection: ProjectedReality = buildProjection({
    taskId: task.id,
    workingResources: capsuleWorkingResources,
    currentModules: [],
    capsuleId: latestCapsule?.id,
    checkpointId: latestCheckpoint?.id,
    contractId: contract?.id,
    capsuleHash: latestCapsule
      ? computeContentHash(latestCapsule.goal, latestCapsule.workingResources, latestCapsule.completedWork, latestCapsule.remainingWork)
      : undefined,
    checkpointHash: latestCheckpoint
      ? computeContentHash(latestCheckpoint.summary, latestCheckpoint.progress)
      : undefined,
    contractHash: contract
      ? computeContentHash(contract.title, contract.scope, contract.responsibilities, contract.interfaceSpec, contract.fileBoundaries, contract.testPlan, contract.risks, contract.status)
      : undefined,
  });
  protocolGate = injectProjectionIntoGate(protocolGate, projection);

  // 1. Enforce context policy (hard gate)
  const policy = repo.enforceContextPolicy(task.id, agent.id);
  if (!policy.ready) {
    throw new LoopError(EXIT.CONTEXT_POLICY, `Context not ready: ${policy.warnings.join("; ")}`);
  }

  // 1a. Capsule validation — agent-scoped checkpoint (latestCheckpoint from step 0b)
  const capsuleVal = validateCapsule(latestCapsule, latestCheckpoint, task.id, agent.id);

  // 1b. P4C: Constraint Runtime enforcement
  const constraintDecision = evaluateConstraints({
    action: "resume",
    projection,
    touchedResources: capsuleWorkingResources.length > 0
      ? resolveResourceRefs(capsuleWorkingResources, agent.id)
      : undefined,
  });
  const constraintWarnings = [
    ...constraintDecision.blockers.map(b => `[BLOCKED] ${b.rule}: ${b.message}`),
    ...constraintDecision.warnings.map(w => `[advisory] ${w.rule}: ${w.message}`),
  ];

  // 1c. capsule-locked mode hard-blocks on any validation failure, protocol gate violation,
  //     or constraint violations
  if (mode === "capsule-locked") {
    if (protocolGate.blocked) {
      throw new LoopError(EXIT.CONTEXT_POLICY, `Protocol gate blocked (locked mode): ${protocolGate.hardBlockers.join("; ")}`);
    }
    if (!capsuleVal.valid) {
      throw new LoopError(EXIT.CONTEXT_POLICY, `Capsule validation failed (locked mode): ${capsuleVal.notes.join("; ")}`);
    }
    if (!constraintDecision.permitted) {
      const reasons = constraintDecision.blockers.map(b => b.message).join("; ");
      throw new LoopError(EXIT.CONTEXT_POLICY, `Constraint violation (locked mode): ${reasons}`);
    }
  }

  // 2. Ensure task is IN_PROGRESS
  const freshTask = repo.getTask(task.id);
  if (freshTask.status === "READY_TO_WORK" || freshTask.status === "NEEDS_SYNC") {
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
  }

  // 3. Generate adapter files
  //    P3B: strip raw projectMemories — agent sees projected reality only.
  //    This prevents all adapter formats (cursorrules, agents-md, etc.) from leaking raw PM.
  const ctx = repo.getResumeContext(task.id, agent.id);
  ctx.contextMode = mode;
  ctx.projectMemories = [];
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "resume" as AdapterLifecycleEvent, projection);

  // 4. Build three-layer prompt with P3B projection integration
  const format = input.format ?? "system-prompt";
  let prompt: string;

  if (format === "system-prompt") {
    const sections: string[] = [];

    sections.push("You are resuming work on a task managed by SyncPoint.");
    sections.push("Below is the ONLY context you should use. Do NOT rely on prior conversation history.");
    sections.push("");

    // Layer 1: Protocol Gate (now includes projection rules + constraints)
    const gatePrompt = formatProtocolGatePrompt(protocolGate);
    if (gatePrompt) sections.push(gatePrompt);

    // Layer 2: Capsule Reality
    sections.push(`## Task: ${ctx.task.title}`);
    sections.push(`- ID: ${ctx.task.id}`);
    sections.push(`- Status: ${ctx.task.status}`);
    sections.push(`- Your role: ${ctx.agent.name} (${ctx.agent.role})`);
    sections.push("");

    if (ctx.latestCapsule) {
      const capsulePrompt = formatCapsuleReality(ctx.latestCapsule as any);
      if (capsulePrompt) sections.push(capsulePrompt);
    }

    // P3B — Inject projected reality (capsulePatch) instead of raw project memories.
    // Agent sees compiled reality, not raw Project Memory.
    // Key boundary: hard_constraint → gate only, NOT capsule.
    const patch = projection.capsulePatch;
    const hasPatchContent =
      patch.verifiedFacts.length > 0 ||
      patch.activeConstraints.length > 0 ||
      patch.risks.length > 0 ||
      patch.doNotTouch.length > 0;

    if (hasPatchContent) {
      sections.push("## Projected Reality");
      sections.push(`> Projection: ${projection.projectionId} | Memory v${projection.createdFrom.memoryVersion} | ${projection.projectionValidity}`);
      sections.push("");

      if (patch.verifiedFacts.length > 0) {
        sections.push("### Verified Facts");
        for (const f of patch.verifiedFacts) {
          sections.push(`- ${f.title}: ${f.content} [ref:${f.source.sourceMemoryId}]`);
        }
        sections.push("");
      }
      if (patch.activeConstraints.length > 0) {
        sections.push("### Active Constraints");
        for (const c of patch.activeConstraints) {
          sections.push(`- ${c.title}: ${c.content} [ref:${c.source.sourceMemoryId}]`);
        }
        sections.push("");
      }
      if (patch.risks.length > 0) {
        sections.push("### Known Risks");
        for (const r of patch.risks) {
          sections.push(`- ⚠ ${r.title}: ${r.content} [ref:${r.source.sourceMemoryId}]`);
        }
        sections.push("");
      }
      if (patch.doNotTouch.length > 0) {
        sections.push("### Do Not Touch");
        for (const d of patch.doNotTouch) {
          sections.push(`- ⛔ ${d.title}: ${d.content} [ref:${d.source.sourceMemoryId}]`);
        }
        sections.push("");
      }
    }

    // capsule-first: also include checkpoint (NOT raw project memories)
    if (mode === "capsule-first" && ctx.latestCheckpoint) {
      sections.push("## Latest Checkpoint");
      sections.push(`- ${ctx.latestCheckpoint.summary}`);
      if (ctx.latestCheckpoint.progress) sections.push(`- Progress: ${ctx.latestCheckpoint.progress}`);
      if (ctx.latestCheckpoint.nextSteps) sections.push(`- Next: ${ctx.latestCheckpoint.nextSteps}`);
      if (ctx.latestCheckpoint.needSync) sections.push("- ⚠ Sync required before continuing");
      sections.push("");
    }

    // Projection conflicts (explicit)
    if (projection.conflicts.length > 0) {
      sections.push("## ⚠ Projection Conflicts");
      for (const c of projection.conflicts) {
        sections.push(`- ${c.description} (${c.itemA.sourceMemoryId} vs ${c.itemB.sourceMemoryId})`);
      }
      sections.push("");
    }

    // Skipped stale memories (transparency)
    if (projection.skippedStale.length > 0) {
      sections.push("## Skipped (stale/invalid)");
      for (const s of projection.skippedStale) {
        sections.push(`- ${s.sourceMemoryId}: ${s.projectionReason}`);
      }
      sections.push("");
    }

    // Layer 3: Validation Notes
    const valPrompt = formatValidationNotes(capsuleVal);
    if (valPrompt) sections.push(valPrompt);

    if (ctx.warnings.length > 0) {
      sections.push("## Warnings");
      for (const w of ctx.warnings) sections.push(`- ${w}`);
      sections.push("");
    }

    prompt = sections.join("\n");
  } else {
    // P2: Non-system-prompt formats now receive projected reality
    prompt = formatResumePrompt(ctx, format, projection);
  }

  return {
    ok: true,
    taskId: task.id,
    agentId: agent.id,
    provider: instruction.provider,
    contextReady: ctx.ready,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
    prompt,
    contextMode: mode,
    protocolGateBlocked: protocolGate.blocked,
    capsuleValid: capsuleVal.valid,
    validationNotes: capsuleVal.notes,
    constraintWarnings,
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
    workingResources: input.workingResources || (latestCapsule?.workingResources ?? ""),
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
  //    P3B: strip raw projectMemories — agent sees projected reality only.
  const ctx = repo.getResumeContext(task.id, agent.id);
  ctx.projectMemories = [];
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
    workingResources: latestCapsule?.workingResources ?? "",
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
  //    P3B: strip raw projectMemories — agent sees projected reality only.
  //    P2: build projection for receiver context (close handoff bypass path).
  const ctx = repo.getResumeContext(task.id, toAgent.id);
  ctx.projectMemories = [];

  // P2: build projected reality for handoff receiver
  const receiverProjection = buildProjection({
    taskId: task.id,
    workingResources: ctx.latestCapsule?.workingResources?.split(",").map(f => f.trim()).filter(Boolean) ?? [],
  });

  // P2: inject projected reality into handoff context prompt
  const handoffPrompt = formatResumePrompt(ctx, "system-prompt", receiverProjection);
  ctx.resumePrompt = handoffPrompt;

  const provider = input.provider ?? toAgent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "handoff" as AdapterLifecycleEvent, receiverProjection);

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
