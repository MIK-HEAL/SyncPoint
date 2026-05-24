import {
  getAgent,
  getTask,
} from "../../repositories/_exports/foundation.js";
import {
  enforceContextPolicy,
  getContractForTask,
  getLatestContextSnapshot,
  listCheckpoints,
} from "../../repositories/_exports/context-memory.js";
import type { LoopStatusInput, LoopStatusResult } from "./types.js";

export function loopStatus(input: LoopStatusInput): LoopStatusResult {
  const agent = getAgent(input.agentId);
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

  const task = getTask(taskId);
  const contract = getContractForTask(taskId);
  const latestSnapshot = getLatestContextSnapshot(taskId, agent.id);
  const checkpoints = listCheckpoints(taskId);
  const policy = enforceContextPolicy(taskId, agent.id);

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
    hasSnapshot: !!latestSnapshot,
    contextReady: policy.ready,
    warnings: policy.warnings,
  };
}
