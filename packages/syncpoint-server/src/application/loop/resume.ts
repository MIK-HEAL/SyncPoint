import {
  TaskStatus,
  buildAdapterInstruction,
  formatResumePrompt,
  DEFAULT_CONTEXT_MODE,
  buildConstraintManifest,
} from "syncpoint-core";
import type {
  AdapterLifecycleEvent,
  AgentProvider,
  ContextMode,
} from "syncpoint-core";
import {
  getAgent,
  getTask,
  updateTaskStatus,
} from "../../repositories/_exports/foundation.js";
import {
  enforceContextPolicy,
  getResumeContext,
} from "../../repositories/_exports/context-memory.js";
import {
  assembleProtocolGate,
  injectProjectionIntoGate,
  validateSnapshot,
  formatProtocolGatePrompt,
  formatSnapshotReality,
  formatValidationNotes,
} from "../protocol-gate-service.js";
import { collaborationCoordinator } from "../collaboration-coordinator.js";
import { EXIT, LoopError, type LoopResumeInput, type LoopResumeResult } from "./types.js";

export function loopResume(input: LoopResumeInput): LoopResumeResult {
  const agent = getAgent(input.agentId);
  const task = getTask(input.taskId);
  const mode: ContextMode = input.contextMode ?? DEFAULT_CONTEXT_MODE;

  let protocolGate = assembleProtocolGate(agent.id, task.id, input.sessionId);

  const resumeProjection = collaborationCoordinator.resume.prepareProjectionContext(task.id, agent.id);
  const latestSnapshot = resumeProjection.latestSnapshot;
  const snapshotWorkingResources = resumeProjection.workingResources;
  const latestCheckpoint = resumeProjection.latestCheckpoint;
  const projection = resumeProjection.projection;

  const readiness = collaborationCoordinator.execution.evaluateReadiness({
    agentId: agent.id,
    taskId: task.id,
    sessionId: input.sessionId,
    action: "resume",
    workingResources: snapshotWorkingResources,
    touchedResources: resumeProjection.touchedResources,
    projection,
  });
  const blockCheck = readiness.blockCheck;
  if (blockCheck.blocked) {
    const gateIds = blockCheck.blockingGates.map(g => g.id).join(", ");
    throw new LoopError(EXIT.STATE_INVALID, `Agent blocked by sync gate(s): ${gateIds}. Acknowledge before resuming.`);
  }

  protocolGate = injectProjectionIntoGate(protocolGate, projection);

  const policy = enforceContextPolicy(task.id, agent.id);
  if (!policy.ready) {
    throw new LoopError(EXIT.CONTEXT_POLICY, `Context not ready: ${policy.warnings.join("; ")}`);
  }

  const snapshotVal = validateSnapshot(latestSnapshot, latestCheckpoint, task.id, agent.id);

  const constraintInput = {
    action: "resume" as const,
    projection,
    touchedResources: readiness.touchedResources,
  };
  const constraintDecision = readiness.constraintDecision;
  const constraintManifest = buildConstraintManifest(constraintInput, constraintDecision);
  const constraintWarnings = [
    ...constraintDecision.blockers.map(b => `[BLOCKED] ${b.rule}: ${b.message}`),
    ...constraintDecision.warnings.map(w => `[advisory] ${w.rule}: ${w.message}`),
  ];

  if (!constraintDecision.permitted) {
    const reasons = constraintDecision.blockers.map(b => b.message).join("; ");
    throw new LoopError(EXIT.CONTEXT_POLICY, `Constraint violation: ${reasons}`, { constraintManifest });
  }

  if (mode === "snapshot-locked") {
    if (protocolGate.blocked) {
      throw new LoopError(EXIT.CONTEXT_POLICY, `Protocol gate blocked (locked mode): ${protocolGate.hardBlockers.join("; ")}`);
    }
    if (!snapshotVal.valid) {
      throw new LoopError(EXIT.CONTEXT_POLICY, `Snapshot validation failed (locked mode): ${snapshotVal.notes.join("; ")}`);
    }
  }

  const freshTask = getTask(task.id);
  if (freshTask.status === "READY_TO_WORK" || freshTask.status === "NEEDS_SYNC") {
    updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
  }

  const ctx = getResumeContext(task.id, agent.id);
  ctx.contextMode = mode;
  ctx.projectMemories = [];
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "resume" as AdapterLifecycleEvent, projection);

  const format = input.format ?? "system-prompt";
  let prompt: string;

  if (format === "system-prompt") {
    const sections: string[] = [];

    sections.push("You are resuming work on a task managed by SyncPoint.");
    sections.push("Below is the ONLY context you should use. Do NOT rely on prior conversation history.");
    sections.push("");

    const gatePrompt = formatProtocolGatePrompt(protocolGate);
    if (gatePrompt) sections.push(gatePrompt);

    sections.push(`## Task: ${ctx.task.title}`);
    sections.push(`- ID: ${ctx.task.id}`);
    sections.push(`- Status: ${ctx.task.status}`);
    sections.push(`- Your role: ${ctx.agent.name} (${ctx.agent.role})`);
    sections.push("");

    if (ctx.latestSnapshot) {
      const snapshotPrompt = formatSnapshotReality(ctx.latestSnapshot as any);
      if (snapshotPrompt) sections.push(snapshotPrompt);
    }

    const patch = projection.contextPatch;
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

    if (mode === "snapshot-first" && ctx.latestCheckpoint) {
      sections.push("## Latest Checkpoint");
      sections.push(`- ${ctx.latestCheckpoint.summary}`);
      if (ctx.latestCheckpoint.progress) sections.push(`- Progress: ${ctx.latestCheckpoint.progress}`);
      if (ctx.latestCheckpoint.nextSteps) sections.push(`- Next: ${ctx.latestCheckpoint.nextSteps}`);
      if (ctx.latestCheckpoint.needSync) sections.push("- ⚠ Sync required before continuing");
      sections.push("");
    }

    if (projection.conflicts.length > 0) {
      sections.push("## ⚠ Projection Conflicts");
      for (const c of projection.conflicts) {
        sections.push(`- ${c.description} (${c.itemA.sourceMemoryId} vs ${c.itemB.sourceMemoryId})`);
      }
      sections.push("");
    }

    if (projection.skippedStale.length > 0) {
      sections.push("## Skipped (stale/invalid)");
      for (const s of projection.skippedStale) {
        sections.push(`- ${s.sourceMemoryId}: ${s.projectionReason}`);
      }
      sections.push("");
    }

    const valPrompt = formatValidationNotes(snapshotVal);
    if (valPrompt) sections.push(valPrompt);

    if (ctx.warnings.length > 0) {
      sections.push("## Warnings");
      for (const w of ctx.warnings) sections.push(`- ${w}`);
      sections.push("");
    }

    prompt = sections.join("\n");
  } else {
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
    snapshotValid: snapshotVal.valid,
    validationNotes: snapshotVal.notes,
    constraintWarnings,
    constraintManifest,
  };
}
