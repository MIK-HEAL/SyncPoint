import {
  buildAdapterInstruction,
  formatResumePrompt,
} from "syncpoint-core";
import type {
  AdapterLifecycleEvent,
  AgentProvider,
  ContextSnapshotPayload,
} from "syncpoint-core";
import {
  getAgent,
  getTask,
} from "../../repositories/_exports/foundation.js";
import {
  acceptHandoff,
  createCheckpoint,
  createContextSnapshot,
  createHandoff,
  getLatestContextSnapshot,
  getResumeContext,
} from "../../repositories/_exports/context-memory.js";
import { buildProjection } from "../reality-projection-service.js";
import type { LoopHandoffInput, LoopHandoffResult } from "./types.js";

export function loopHandoff(input: LoopHandoffInput): LoopHandoffResult {
  const fromAgent = getAgent(input.fromAgentId);
  const toAgent = getAgent(input.toAgentId);
  const task = getTask(input.taskId);

  const cp = createCheckpoint({
    taskId: task.id,
    agentId: fromAgent.id,
    summary: `Handoff to ${toAgent.name}: ${input.context}`,
    progress: "",
    currentUnderstanding: "",
    changedResources: [],
    risks: "",
    blockers: "",
    nextSteps: `Handoff to ${toAgent.name}`,
    needSync: false,
  });

  const latestSnapshot = getLatestContextSnapshot(task.id, fromAgent.id);
  let prevP: ContextSnapshotPayload = {};
  if (latestSnapshot) {
    prevP = latestSnapshot.payload ?? {};
  }
  createContextSnapshot({
    taskId: task.id,
    agentId: fromAgent.id,
    checkpointId: cp.id,
    kind: "handoff",
    summary: `Handoff to ${toAgent.name}: ${input.context}`,
    payload: {
      ...prevP,
      currentPhase: "handoff",
      nextSteps: [`Handoff to ${toAgent.name}: ${input.context}`],
      resumePrompt: input.context,
    },
  });

  const handoff = createHandoff({
    taskId: task.id,
    fromAgentId: fromAgent.id,
    toAgentId: toAgent.id,
    contextSummary: input.context,
  });

  let accepted = false;
  if (input.autoAccept) {
    acceptHandoff(handoff.id);
    accepted = true;
  }

  const ctx = getResumeContext(task.id, toAgent.id);
  ctx.projectMemories = [];

  const receiverProjection = buildProjection({
    taskId: task.id,
    workingResources: ctx.latestSnapshot?.payload?.workingResources ?? [],
  });

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
