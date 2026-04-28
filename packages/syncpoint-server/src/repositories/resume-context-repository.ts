/**
 * Resume context assembly — Memory Switch Engine core.
 */

import { eq, and, desc } from "drizzle-orm";
import * as s from "../schema.js";
import {
  ContractStatus,
  QualityCheckStatus,
} from "syncpoint-core";
import type {
  Agent,
  Task,
  Checkpoint,
  PeerContract,
  ContextCapsule,
  ResumeContext,
  QualityCheckResult,
} from "syncpoint-core";
import { _getDb, now } from "./_shared.js";
import { getAgent } from "./agent-repository.js";
import { getTask } from "./task-repository.js";
import { getLatestCapsule } from "./capsule-repository.js";
import { collectPinnedMemories } from "./memory-repository.js";
import { collectProjectMemories } from "./project-memory-repository.js";

/**
 * Run quality checks on the data assembled for resume context.
 */
function runQualityChecks(
  task: Task,
  agent: Agent,
  capsule: ContextCapsule | null | undefined,
  checkpoint: Checkpoint | null | undefined,
  contract: PeerContract | null | undefined,
): { checks: QualityCheckResult[]; warnings: string[]; ready: boolean } {
  const checks: QualityCheckResult[] = [];
  const warnings: string[] = [];

  // Completeness Check: capsule must exist
  if (capsule) {
    checks.push({ name: "Completeness", status: QualityCheckStatus.PASS, message: "Latest capsule exists." });
  } else {
    checks.push({ name: "Completeness", status: QualityCheckStatus.FAIL, message: "No context capsule found. Create one before resuming." });
    warnings.push("No context capsule found for this task+agent. Run `syncpoint capsule create` before resuming.");
  }

  // Freshness Check: capsule should be newer than checkpoint
  if (capsule && checkpoint) {
    if (capsule.createdAt >= checkpoint.createdAt) {
      checks.push({ name: "Freshness", status: QualityCheckStatus.PASS, message: "Capsule is up-to-date with latest checkpoint." });
    } else {
      checks.push({ name: "Freshness", status: QualityCheckStatus.WARN, message: "Capsule is older than latest checkpoint. Consider updating." });
      warnings.push("Context capsule is older than latest checkpoint. Consider creating a new capsule.");
    }
  } else if (!checkpoint) {
    checks.push({ name: "Freshness", status: QualityCheckStatus.WARN, message: "No checkpoint found." });
  }

  // Approval Check: if task has a contract, it should be APPROVED
  if (contract) {
    if (contract.status === ContractStatus.APPROVED) {
      checks.push({ name: "Approval", status: QualityCheckStatus.PASS, message: "Peer contract is approved." });
    } else {
      checks.push({ name: "Approval", status: QualityCheckStatus.FAIL, message: `Peer contract status is ${contract.status}. Must be APPROVED for parallel work.` });
      warnings.push(`Peer contract is ${contract.status}, not APPROVED. Approve contract before starting parallel work.`);
    }
  } else {
    checks.push({ name: "Approval", status: QualityCheckStatus.PASS, message: "No peer contract required." });
  }

  // Conflict Check: blockers
  if (capsule?.blockers && capsule.blockers.trim().length > 0) {
    checks.push({ name: "Conflict", status: QualityCheckStatus.WARN, message: `Blockers present: ${capsule.blockers.slice(0, 100)}` });
    warnings.push(`Unresolved blockers: ${capsule.blockers}`);
  } else {
    checks.push({ name: "Conflict", status: QualityCheckStatus.PASS, message: "No blockers." });
  }

  // Scope Check: capsule belongs to this task+agent
  if (capsule && (capsule.taskId !== task.id || capsule.agentId !== agent.id)) {
    checks.push({ name: "Scope", status: QualityCheckStatus.FAIL, message: "Capsule does not belong to this task+agent pair." });
    warnings.push("Scope violation: capsule taskId/agentId mismatch.");
  } else if (capsule) {
    checks.push({ name: "Scope", status: QualityCheckStatus.PASS, message: "Capsule is scoped to correct task+agent." });
  }

  // NeedSync Check
  if (checkpoint?.needSync) {
    checks.push({ name: "NeedSync", status: QualityCheckStatus.WARN, message: "Latest checkpoint has needSync=true." });
    warnings.push("Latest checkpoint flagged needSync — coordinate with other agents before continuing.");
  }

  const ready = checks.every(c => c.status !== QualityCheckStatus.FAIL);
  return { checks, warnings, ready };
}

/**
 * Build a text resume prompt from structured context.
 * This is what an AI should receive when resuming work.
 */
function buildResumePrompt(
  task: Task,
  agent: Agent,
  contract: PeerContract | null,
  capsule: ContextCapsule | null,
  checkpoint: Checkpoint | null,
  pinnedMemories: Array<{ key: string; content: string }>,
  projectMemories: Array<{ id: string; category: string; title: string; content: string }> = [],
): string {
  const lines: string[] = [];

  lines.push(`# Resume Context: ${task.title}`);
  lines.push("");
  lines.push(`**Task ID**: ${task.id}`);
  lines.push(`**Status**: ${task.status}`);
  lines.push(`**Agent**: ${agent.name} (${agent.role})`);
  lines.push("");

  if (pinnedMemories.length > 0) {
    lines.push("## Pinned Rules");
    for (const m of pinnedMemories) {
      lines.push(`- **${m.key}**: ${m.content}`);
    }
    lines.push("");
  }

  if (projectMemories.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of projectMemories) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  }

  if (contract) {
    lines.push("## Approved Peer Contract");
    if (contract.title) lines.push(`**Title**: ${contract.title}`);
    if (contract.scope) lines.push(`**Scope**: ${contract.scope}`);
    if (contract.responsibilities) lines.push(`**Responsibilities**: ${contract.responsibilities}`);
    if (contract.interfaceSpec) lines.push(`**Interface**: ${contract.interfaceSpec}`);
    if (contract.fileBoundaries) lines.push(`**File Boundaries**: ${contract.fileBoundaries}`);
    lines.push("");
  }

  if (capsule) {
    lines.push("## Current Task Context");
    if (capsule.goal) lines.push(`**Goal**: ${capsule.goal}`);
    if (capsule.currentPhase) lines.push(`**Phase**: ${capsule.currentPhase}`);
    if (capsule.confirmedDecisions) lines.push(`**Decisions**: ${capsule.confirmedDecisions}`);
    if (capsule.workingFiles) lines.push(`**Files**: ${capsule.workingFiles}`);
    if (capsule.completedWork) lines.push(`**Done**: ${capsule.completedWork}`);
    if (capsule.remainingWork) lines.push(`**Remaining**: ${capsule.remainingWork}`);
    if (capsule.risks) lines.push(`**Risks**: ${capsule.risks}`);
    if (capsule.blockers) lines.push(`**Blockers**: ${capsule.blockers}`);
    if (capsule.nextSteps) lines.push(`**Next Steps**: ${capsule.nextSteps}`);
    lines.push("");
    if (capsule.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push(capsule.resumePrompt);
      lines.push("");
    }
  }

  if (checkpoint) {
    lines.push("## Latest Checkpoint");
    lines.push(`**Summary**: ${checkpoint.summary}`);
    if (checkpoint.progress) lines.push(`**Progress**: ${checkpoint.progress}`);
    if (checkpoint.risks) lines.push(`**Risks**: ${checkpoint.risks}`);
    if (checkpoint.blockers) lines.push(`**Blockers**: ${checkpoint.blockers}`);
    if (checkpoint.nextSteps) lines.push(`**Next**: ${checkpoint.nextSteps}`);
    if (checkpoint.needSync) lines.push("⚠ **Sync required** before continuing.");
    lines.push("");
  }

  if (!capsule && !checkpoint) {
    lines.push("⚠ No capsule or checkpoint found. Create a context capsule before starting work.");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get structured resume context for a task+agent.
 * This is the core Memory Switch Engine entry point.
 */
export function getResumeContext(taskId: string, agentId: string): ResumeContext {
  const task = getTask(taskId);
  const agent = getAgent(agentId);

  // Approved contract for task
  const allContracts = _getDb().select().from(s.peerContracts)
    .where(eq(s.peerContracts.taskId, taskId)).all() as unknown as PeerContract[];
  const approvedContract = allContracts.find(c => c.status === ContractStatus.APPROVED) ?? null;
  const latestContract = allContracts.length ? allContracts[allContracts.length - 1] : null;

  // Latest capsule for this agent+task
  const capsule = getLatestCapsule(taskId, agentId) ?? null;

  // Latest checkpoint for this agent+task
  const checkpoint = _getDb().select().from(s.checkpoints)
    .where(and(eq(s.checkpoints.taskId, taskId), eq(s.checkpoints.agentId, agentId)))
    .orderBy(desc(s.checkpoints.createdAt))
    .limit(1)
    .get() as unknown as Checkpoint | undefined ?? null;

  // Pinned memories
  const pinnedMemories = collectPinnedMemories(taskId);

  // Project memories (approved knowledge)
  const projectMems = collectProjectMemories(taskId);

  // Quality checks
  const contractForChecks = approvedContract ?? latestContract;
  const { checks, warnings, ready } = runQualityChecks(task, agent, capsule, checkpoint, contractForChecks);

  // Build resume prompt
  const resumePrompt = buildResumePrompt(task, agent, approvedContract, capsule, checkpoint, pinnedMemories, projectMems);

  return {
    taskId,
    agentId,
    ready,
    checks,
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      ownerAgentId: task.ownerAgentId,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
    },
    approvedContract: approvedContract ? {
      id: approvedContract.id,
      title: approvedContract.title,
      scope: approvedContract.scope,
      responsibilities: approvedContract.responsibilities,
      interfaceSpec: approvedContract.interfaceSpec,
      fileBoundaries: approvedContract.fileBoundaries,
      status: approvedContract.status,
    } : null,
    latestCapsule: capsule ? {
      id: capsule.id,
      goal: capsule.goal,
      currentPhase: capsule.currentPhase,
      confirmedDecisions: capsule.confirmedDecisions,
      workingFiles: capsule.workingFiles,
      completedWork: capsule.completedWork,
      remainingWork: capsule.remainingWork,
      risks: capsule.risks,
      blockers: capsule.blockers,
      nextSteps: capsule.nextSteps,
      resumePrompt: capsule.resumePrompt,
      createdAt: capsule.createdAt,
    } : null,
    latestCheckpoint: checkpoint ? {
      id: checkpoint.id,
      summary: checkpoint.summary,
      progress: checkpoint.progress,
      risks: checkpoint.risks,
      blockers: checkpoint.blockers,
      nextSteps: checkpoint.nextSteps,
      needSync: checkpoint.needSync,
      createdAt: checkpoint.createdAt,
    } : null,
    pinnedMemories,
    projectMemories: projectMems,
    resumePrompt,
    warnings,
    generatedAt: now(),
  };
}

/**
 * Enforce context policy — returns {ready, warnings}.
 * If not ready, the AI should NOT proceed without addressing warnings.
 */
export function enforceContextPolicy(taskId: string, agentId: string): { ready: boolean; warnings: string[] } {
  const ctx = getResumeContext(taskId, agentId);
  return { ready: ctx.ready, warnings: ctx.warnings };
}
