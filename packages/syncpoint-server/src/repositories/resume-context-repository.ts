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
  ContextSnapshot,
  ContextSnapshotPayload,
  ResumeContext,
  QualityCheckResult,
} from "syncpoint-core";
import { _getDb, now } from "./_shared.js";
import { getAgent } from "./agent-repository.js";
import { getTask } from "./task-repository.js";
import { getLatestContextSnapshot } from "./context-snapshot-repository.js";
import { collectPinnedMemories } from "./memory-repository.js";
import { collectProjectMemories } from "./project-memory-repository.js";

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseChangedFiles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hydrateContractRow(row: typeof s.peerContracts.$inferSelect): PeerContract {
  return {
    ...row,
    participants: parseStringList(row.participants),
    responsibilities: parseStringList(row.responsibilities),
    interfaceSpec: parseStringList(row.interfaceSpec),
    fileBoundaries: parseStringList(row.fileBoundaries),
    dependencies: parseStringList(row.dependencies),
  } as PeerContract;
}

function hydrateCheckpointRow(row: typeof s.checkpoints.$inferSelect): Checkpoint {
  return {
    ...row,
    changedFiles: parseChangedFiles(row.changedFiles),
  } as Checkpoint;
}

/**
 * Run quality checks on the data assembled for resume context.
 */
function parsePayload(snapshot: ContextSnapshot | null | undefined): ContextSnapshotPayload {
  return snapshot?.payload ?? {};
}

function runQualityChecks(
  task: Task,
  agent: Agent,
  snapshot: ContextSnapshot | null | undefined,
  checkpoint: Checkpoint | null | undefined,
  contract: PeerContract | null | undefined,
): { checks: QualityCheckResult[]; warnings: string[]; ready: boolean } {
  const checks: QualityCheckResult[] = [];
  const warnings: string[] = [];

  // Completeness Check: snapshot must exist
  if (snapshot) {
    checks.push({ name: "Completeness", status: QualityCheckStatus.PASS, message: "Latest snapshot exists." });
  } else {
    checks.push({ name: "Completeness", status: QualityCheckStatus.FAIL, message: "No context snapshot found. Create one before resuming." });
    warnings.push("No context snapshot found for this task+agent. Run `syncpoint snapshot create` before resuming.");
  }

  // Freshness Check: snapshot should be newer than checkpoint
  if (snapshot && checkpoint) {
    if (snapshot.createdAt >= checkpoint.createdAt) {
      checks.push({ name: "Freshness", status: QualityCheckStatus.PASS, message: "Snapshot is up-to-date with latest checkpoint." });
    } else {
      checks.push({ name: "Freshness", status: QualityCheckStatus.WARN, message: "Snapshot is older than latest checkpoint. Consider updating." });
      warnings.push("Context snapshot is older than latest checkpoint. Consider creating a new snapshot.");
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
  const payload = parsePayload(snapshot);
  const blockerText = (payload.blockers ?? []).join(", ");
  if (blockerText.length > 0) {
    checks.push({ name: "Conflict", status: QualityCheckStatus.WARN, message: `Blockers present: ${blockerText.slice(0, 100)}` });
    warnings.push(`Unresolved blockers: ${blockerText}`);
  } else {
    checks.push({ name: "Conflict", status: QualityCheckStatus.PASS, message: "No blockers." });
  }

  // Scope Check: snapshot belongs to this task+agent
  if (snapshot && (snapshot.taskId !== task.id || snapshot.agentId !== agent.id)) {
    checks.push({ name: "Scope", status: QualityCheckStatus.FAIL, message: "Snapshot does not belong to this task+agent pair." });
    warnings.push("Scope violation: snapshot taskId/agentId mismatch.");
  } else if (snapshot) {
    checks.push({ name: "Scope", status: QualityCheckStatus.PASS, message: "Snapshot is scoped to correct task+agent." });
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
  snapshot: ContextSnapshot | null,
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
    if (contract.responsibilities.length) lines.push(`**Responsibilities**: ${contract.responsibilities.join(", ")}`);
    if (contract.interfaceSpec.length) lines.push(`**Interface**: ${contract.interfaceSpec.join(", ")}`);
    if (contract.fileBoundaries.length) lines.push(`**File Boundaries**: ${contract.fileBoundaries.join(", ")}`);
    lines.push("");
  }

  if (snapshot) {
    const p = parsePayload(snapshot);
    lines.push("## Current Task Context");
    if (snapshot.summary) lines.push(`**Summary**: ${snapshot.summary}`);
    if (p.goal) lines.push(`**Goal**: ${p.goal}`);
    if (p.currentPhase) lines.push(`**Phase**: ${p.currentPhase}`);
    if (p.confirmedDecisions?.length) lines.push(`**Decisions**: ${p.confirmedDecisions.join("; ")}`);
    if (p.workingResources?.length) lines.push(`**Resources**: ${p.workingResources.join(", ")}`);
    if (p.completedWork) lines.push(`**Done**: ${p.completedWork}`);
    if (p.remainingWork) lines.push(`**Remaining**: ${p.remainingWork}`);
    if (p.risks?.length) lines.push(`**Risks**: ${p.risks.join(", ")}`);
    if (p.blockers?.length) lines.push(`**Blockers**: ${p.blockers.join(", ")}`);
    if (p.nextSteps?.length) lines.push(`**Next Steps**: ${p.nextSteps.join(", ")}`);
    lines.push("");
    if (p.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push(p.resumePrompt);
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

  if (!snapshot && !checkpoint) {
    lines.push("⚠ No snapshot or checkpoint found. Create a context snapshot before starting work.");
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
    .where(eq(s.peerContracts.taskId, taskId)).all().map(hydrateContractRow);
  const approvedContract = allContracts.find(c => c.status === ContractStatus.APPROVED) ?? null;
  const latestContract = allContracts.length ? allContracts[allContracts.length - 1] : null;

  // Latest snapshot for this agent+task
  const snapshot = getLatestContextSnapshot(taskId, agentId) ?? null;

  // Latest checkpoint for this agent+task
  const checkpoint = _getDb().select().from(s.checkpoints)
    .where(and(eq(s.checkpoints.taskId, taskId), eq(s.checkpoints.agentId, agentId)))
    .orderBy(desc(s.checkpoints.createdAt))
    .limit(1)
    .get();
  const latestCheckpoint = checkpoint ? hydrateCheckpointRow(checkpoint) : null;

  // Pinned memories
  const pinnedMemories = collectPinnedMemories(taskId);

  // Project memories (approved knowledge)
  const projectMems = collectProjectMemories(taskId);

  // Quality checks
  const contractForChecks = approvedContract ?? latestContract;
  const { checks, warnings, ready } = runQualityChecks(task, agent, snapshot, latestCheckpoint, contractForChecks);

  // Build resume prompt
  const resumePrompt = buildResumePrompt(task, agent, approvedContract, snapshot, latestCheckpoint, pinnedMemories, projectMems);

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
    latestSnapshot: snapshot ? {
      id: snapshot.id,
      kind: snapshot.kind,
      summary: snapshot.summary,
      payload: snapshot.payload,
      createdAt: snapshot.createdAt,
    } : null,
    latestCheckpoint: latestCheckpoint ? {
      id: latestCheckpoint.id,
      summary: latestCheckpoint.summary,
      progress: latestCheckpoint.progress,
      risks: latestCheckpoint.risks,
      blockers: latestCheckpoint.blockers,
      nextSteps: latestCheckpoint.nextSteps,
      needSync: latestCheckpoint.needSync,
      createdAt: latestCheckpoint.createdAt,
    } : null,
    pinnedMemories,
    projectMemories: projectMems,
    resumePrompt,
    warnings,
    contextMode: "snapshot-first",
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
