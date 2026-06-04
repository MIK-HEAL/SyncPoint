import {
  TaskStatus,
  buildAdapterInstruction,
} from "syncpoint-adapters";
import type { AdapterLifecycleEvent, AgentProvider } from "syncpoint-adapters";
import {
  assignTask,
  getAgent,
  getTask,
  updateTaskStatus,
} from "../../repositories/_exports/foundation.js";
import {
  enforceContextPolicy,
  getResumeContext,
} from "../../repositories/_exports/context-memory.js";
import { EXIT, LoopError, type LoopBootInput, type LoopBootResult } from "./types.js";

export function loopBoot(input: LoopBootInput): LoopBootResult {
  const agent = getAgent(input.agentId);
  const task = getTask(input.taskId);

  if (task.ownerAgentId !== agent.id) {
    if (task.status === "OPEN") {
      assignTask(task.id, agent.id);
    } else if (task.ownerAgentId && task.ownerAgentId !== agent.id) {
      throw new LoopError(EXIT.STATE_INVALID, `Task ${task.id} is assigned to ${task.ownerAgentId}, not ${agent.id}`);
    }
  }

  const freshTask = getTask(task.id);
  if (freshTask.status === "ASSIGNED" || freshTask.status === "READY_TO_WORK") {
    updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
  }

  enforceContextPolicy(task.id, agent.id);

  const ctx = getResumeContext(task.id, agent.id);
  ctx.projectMemories = [];
  const provider = input.provider ?? agent.name;
  const instruction = buildAdapterInstruction(ctx, provider as AgentProvider, "boot" as AdapterLifecycleEvent);

  return {
    ok: true,
    taskId: task.id,
    agentId: agent.id,
    provider: instruction.provider,
    taskStatus: getTask(task.id).status,
    contextReady: ctx.ready,
    filesWritten: Object.keys(instruction.files),
    files: instruction.files,
    warnings: ctx.warnings,
  };
}
