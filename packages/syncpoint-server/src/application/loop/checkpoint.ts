import {
  TaskStatus,
  buildAdapterInstruction,
} from "syncpoint-adapters";
import type { AdapterLifecycleEvent, AgentProvider } from "syncpoint-adapters";
import type { ContextSnapshotPayload } from "syncpoint-context";
import {
  getAgent,
  getTask,
  updateTaskStatus,
} from "../../repositories/_exports/foundation.js";
import {
  createCheckpoint,
  createContextSnapshot,
  getLatestContextSnapshot,
  getResumeContext,
} from "../../repositories/_exports/context-memory.js";
import type { LoopCheckpointInput, LoopCheckpointResult } from "./types.js";

export function loopCheckpoint(input: LoopCheckpointInput): LoopCheckpointResult {
  const agent = getAgent(input.agentId);
  const task = getTask(input.taskId);

  const cp = createCheckpoint({
    taskId: task.id,
    agentId: agent.id,
    summary: input.summary,
    progress: input.progress ?? "",
    currentUnderstanding: "",
    changedResources: [],
    risks: input.risks ?? "",
    blockers: input.blockers ?? "",
    nextSteps: input.nextSteps ?? "",
    needSync: input.needSync ?? false,
  });

  const latestSnapshot = getLatestContextSnapshot(task.id, agent.id);
  let prevPayload: ContextSnapshotPayload = {};
  if (latestSnapshot) {
    prevPayload = latestSnapshot.payload ?? {};
  }
  const snapshot = createContextSnapshot({
    taskId: task.id,
    agentId: agent.id,
    checkpointId: cp.id,
    summary: input.summary,
    payload: {
      goal: input.goal || (prevPayload.goal ?? ""),
      currentPhase: input.phase || (prevPayload.currentPhase ?? ""),
      confirmedDecisions: prevPayload.confirmedDecisions ?? [],
      workingResources: input.workingResources ? input.workingResources.split(",").map((s: string) => s.trim()).filter(Boolean) : (prevPayload.workingResources ?? []),
      completedWork: input.completed || "",
      remainingWork: input.remaining || "",
      risks: input.risks ? [input.risks] : [],
      blockers: input.blockers ? [input.blockers] : [],
      nextSteps: input.nextSteps ? [input.nextSteps] : [],
      resumePrompt: input.resumePrompt || input.summary,
    },
  });

  if (input.needSync && task.status === "IN_PROGRESS") {
    updateTaskStatus(task.id, TaskStatus.NEEDS_SYNC);
  }

  const ctx = getResumeContext(task.id, agent.id);
  ctx.projectMemories = [];
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "checkpoint" as AdapterLifecycleEvent);

  return {
    ok: true,
    taskId: task.id,
    agentId: agent.id,
    checkpointId: cp.id,
    snapshotId: snapshot.id,
    needSync: input.needSync ?? false,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
  };
}
