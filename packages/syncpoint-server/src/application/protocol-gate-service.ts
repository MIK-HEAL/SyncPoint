/**
 * Protocol Gate & Snapshot Validation — P12 context assembly layer.
 *
 * Design principle:
 *   snapshot-only means agent working-context only, not protocol-only.
 *   Protocol rules are never absorbed into snapshot — they remain a hard external layer.
 *
 * Three layers:
 *   1. Protocol Gate   — hard collaboration rules
 *   2. Snapshot Reality — agent's current task working memory
 *   3. Validation Notes — staleness, evidence coverage, missing proof
 */

import type {
  ProtocolRule,
  ProtocolGateSummary,
  SnapshotValidation,
  ContextSnapshot,
  Checkpoint,
  PeerContract,
  RealityProjection,
} from "syncpoint-core";
import { ContractStatus, CheckpointReviewStatus } from "syncpoint-core";
import * as contextMemoryRepo from "../repositories/_exports/context-memory.js";
import * as orchestrationRepo from "../repositories/_exports/orchestration.js";
import * as protocolRepo from "../repositories/_exports/protocol.js";
import { sgCheckAgent } from "./sync-gate-service.js";
import { rcDetectConflicts } from "./resource-claim-service.js";
import { wakeList } from "./wake-engine-service.js";

// ══════════════════════════════════════════════════════
// Protocol Gate Assembler
// ══════════════════════════════════════════════════════

/**
 * Assemble the full protocol gate summary for an agent + task context.
 * This collects all active collaboration rules from every protocol source.
 */
export function assembleProtocolGate(
  agentId: string,
  taskId: string,
  sessionId?: string,
): ProtocolGateSummary {
  const rules: ProtocolRule[] = [];

  // 1. Pinned memories — always enforced
  const pinned = contextMemoryRepo.collectPinnedMemories(taskId);
  for (const m of pinned) {
    rules.push({
      source: "pinned-memory",
      severity: "hard",
      summary: `${m.key}: ${m.content}`,
    });
  }

  // 2. Peer contract constraints
  const approved = contextMemoryRepo.getContractForTask(taskId);
  if (approved && approved.status === ContractStatus.APPROVED) {
    if (approved.scope) {
      rules.push({ source: "peer-contract", severity: "hard", summary: `Scope: ${approved.scope}`, entityId: approved.id });
    }
    if (approved.fileBoundaries.length) {
      rules.push({ source: "peer-contract", severity: "hard", summary: `Resource boundaries: ${approved.fileBoundaries.join(", ")}`, entityId: approved.id });
    }
    if (approved.responsibilities.length) {
      rules.push({ source: "peer-contract", severity: "soft", summary: `Responsibilities: ${approved.responsibilities.join(", ")}`, entityId: approved.id });
    }
    if (approved.interfaceSpec.length) {
      rules.push({ source: "peer-contract", severity: "soft", summary: `Interface: ${approved.interfaceSpec.join(", ")}`, entityId: approved.id });
    }
  }

  // 3. Resource claims for this agent
  const claims = protocolRepo.listActiveResourceClaims(sessionId ? { sessionId } : undefined);
  const agentClaims = claims.filter((c: any) => c.actorId === agentId);
  for (const c of agentClaims) {
    const locators = c.resources?.map((r: any) => `${r.type}:${r.locator}`).join(", ") ?? "";
    rules.push({
      source: "resource-claim",
      severity: "info",
      summary: `Claimed: ${locators} (${c.mode ?? "exclusive"})`,
      entityId: c.id,
    });
  }

  // 4. Resource conflicts
  const conflicts = rcDetectConflicts(sessionId ? { sessionId } : undefined);
  const agentConflicts = conflicts.filter((c: any) => c.claimA.actorId === agentId || c.claimB.actorId === agentId);
  for (const c of agentConflicts) {
    rules.push({
      source: "resource-claim",
      severity: c.isHardConflict ? "hard" : "soft",
      summary: `Conflict on ${c.overlappingLocator}: ${c.claimA.actorId} vs ${c.claimB.actorId}`,
    });
  }

  // 5. Sync gates blocking this agent
  const gateCheck = sgCheckAgent(agentId, { taskId, sessionId });
  for (const g of gateCheck.blockingGates) {
    rules.push({
      source: "sync-gate",
      severity: "hard",
      summary: `SyncGate ${g.id}: ${g.description || g.reason} — awaiting ack`,
      entityId: g.id,
    });
  }

  // 6. Active checkpoint reviews
  const CR_BLOCKING: Set<string> = new Set([
    CheckpointReviewStatus.OPEN,
    CheckpointReviewStatus.WAITING_APPROVAL,
    CheckpointReviewStatus.REJECTED,
  ]);
  try {
    const txns = protocolRepo.listActiveCheckpointReviews({ taskId, sessionId });
    for (const tx of txns) {
      const isBlocking = CR_BLOCKING.has(tx.status as string);
      rules.push({
        source: "checkpoint-review",
        severity: isBlocking ? "hard" : "soft",
        summary: `CheckpointReview ${tx.id}: ${tx.status}`,
        entityId: tx.id,
      });
    }
  } catch { /* no checkpoint reviews module — ok */ }

  // 7. Pending reviews
  try {
    const reviews = sessionId ? orchestrationRepo.listReviewRequests(sessionId) : [];
    for (const r of reviews) {
      if (r.status === "PENDING" && r.reviewerAgentId === agentId) {
        rules.push({
          source: "review",
          severity: "soft",
          summary: `Review pending: ${r.id} — you are the reviewer`,
          entityId: r.id,
        });
      }
    }
  } catch { /* ok */ }

  // 8. Pending wakes for this agent
  try {
    const wakes = wakeList({ agentId, status: "QUEUED" });
    for (const w of wakes) {
      rules.push({
        source: "wake",
        severity: "info",
        summary: `Wake queued: ${(w as any).action ?? w.id}`,
        entityId: w.id,
      });
    }
  } catch { /* ok */ }

  // Compute summary — blocked = any hard rule from a blocking source
  const hardBlockers = rules.filter(r => r.severity === "hard").map(r => r.summary);
  const hasBlockingGates = gateCheck.blocked;
  const hasHardConflicts = agentConflicts.some((c: any) => c.isHardConflict);
  const hasActiveSubmittedTx = rules.some(r => r.source === "checkpoint-review" && r.severity === "hard");
  const blocked = hasBlockingGates || hasHardConflicts || hasActiveSubmittedTx;

  return {
    rules,
    blocked,
    hardBlockers,
    counts: {
      pinnedRules: pinned.length,
      contractConstraints: rules.filter(r => r.source === "peer-contract").length,
      resourceClaims: agentClaims.length,
      activeGates: gateCheck.blockingGates.length,
      activeTransactions: rules.filter(r => r.source === "checkpoint-review").length,
      pendingReviews: rules.filter(r => r.source === "review").length,
      pendingWakes: rules.filter(r => r.source === "wake").length,
      projectionRules: 0,
    },
  };
}

// ══════════════════════════════════════════════════════
// P3B — Projection → Gate injection
// ══════════════════════════════════════════════════════

/**
 * Inject projected protocolRules and constraintRules into the protocol gate.
 * Also injects projection conflicts and validity degradation.
 * Returns a new ProtocolGateSummary (does not mutate input).
 */
export function injectProjectionIntoGate(
  gate: ProtocolGateSummary,
  projection: RealityProjection,
): ProtocolGateSummary {
  const rules: ProtocolRule[] = [...gate.rules];
  const hardBlockers = [...gate.hardBlockers];
  let blocked = gate.blocked;

  // Protocol rules from projection → severity based on memory severity
  for (const pr of projection.protocolRules) {
    const severity = pr.source.confidence === "high" ? "hard" : "soft";
    const summary = `[projection:${pr.source.sourceMemoryId}] ${pr.title}: ${pr.content}`;
    rules.push({ source: "projection", severity, summary, entityId: pr.source.sourceMemoryId });
    if (severity === "hard") hardBlockers.push(summary);
  }

  // Constraint rules → visible as awareness in gate notes, but NOT blocking in P3B.
  // P4 Constraint Runtime will enforce actual violation detection.
  // Severity is "soft" = agent must be aware, but existence alone does not block.
  for (const cr of projection.constraintRules) {
    const summary = `[constraint:${cr.source.sourceMemoryId}] ${cr.title}: ${cr.content}`;
    rules.push({ source: "projection", severity: "soft", summary, entityId: cr.source.sourceMemoryId });
  }

  // Projection conflicts → explicit
  for (const c of projection.conflicts) {
    const summary = `[conflict] ${c.description} (${c.itemA.sourceMemoryId} vs ${c.itemB.sourceMemoryId})`;
    rules.push({ source: "projection", severity: "hard", summary });
    hardBlockers.push(summary);
  }

  // Projection validity degradation
  if (projection.projectionValidity === "invalid") {
    const msg = "Projection invalid — cannot trust projected reality.";
    rules.push({ source: "projection", severity: "hard", summary: msg });
    hardBlockers.push(msg);
    blocked = true;
  }

  // If we added hard projection rules, re-evaluate blocked
  if (hardBlockers.length > gate.hardBlockers.length) {
    blocked = true;
  }

  return {
    rules,
    blocked,
    hardBlockers,
    counts: {
      ...gate.counts,
      projectionRules: projection.protocolRules.length + projection.constraintRules.length + projection.conflicts.length,
    },
  };
}

// ══════════════════════════════════════════════════════
// Snapshot Validation
// ══════════════════════════════════════════════════════

/**
 * Validate a snapshot against the current state.
 * Returns a validation result with notes.
 */
export function validateSnapshot(
  snapshot: ContextSnapshot | null | undefined,
  checkpoint: Checkpoint | null | undefined,
  taskId: string,
  agentId: string,
): SnapshotValidation {
  const notes: string[] = [];
  let valid = true;
  let stale = false;
  let staleReason: string | null = null;
  let scopeMatch = true;
  let hasBlockers = false;
  let hasEvidence = !!checkpoint;
  let needsSync = false;

  if (!snapshot) {
    valid = false;
    notes.push("No context snapshot found. Create one before resuming.");
    return {
      valid, stale, staleReason, scopeMatch, hasBlockers,
      hasEvidence, needsSync, notes,
    };
  }

  // Scope check
  if (snapshot.taskId !== taskId || snapshot.agentId !== agentId) {
    scopeMatch = false;
    valid = false;
    notes.push("Snapshot scope mismatch: taskId or agentId does not match.");
  }

  // Staleness check
  if (checkpoint && snapshot.createdAt < checkpoint.createdAt) {
    stale = true;
    staleReason = `Snapshot (${snapshot.createdAt}) is older than checkpoint (${checkpoint.createdAt}).`;
    valid = false;
    notes.push(`Stale: ${staleReason}`);
  }

  // Evidence check
  if (!checkpoint) {
    hasEvidence = false;
    valid = false;
    notes.push("No checkpoint found — snapshot has no evidence backing.");
  }

  // Blocker check
  const payload = snapshot.payload ?? {};
  const blockerText = Array.isArray(payload.blockers) ? payload.blockers.join(", ") : "";
  if (blockerText.length > 0) {
    hasBlockers = true;
    valid = false;
    notes.push(`Unresolved blockers: ${blockerText.slice(0, 100)}`);
  }

  // NeedSync check
  if (checkpoint?.needSync) {
    needsSync = true;
    valid = false;
    notes.push("Latest checkpoint flagged needSync — coordinate before continuing.");
  }

  return {
    valid,
    stale,
    staleReason,
    scopeMatch,
    hasBlockers,
    hasEvidence,
    needsSync,
    notes,
  };
}

// ══════════════════════════════════════════════════════
// Protocol Gate Prompt Formatter
// ══════════════════════════════════════════════════════

/**
 * Format the protocol gate as a prompt section.
 * This is the "you must obey these rules" block.
 */
export function formatProtocolGatePrompt(gate: ProtocolGateSummary): string {
  if (gate.rules.length === 0) return "";

  const lines: string[] = [];
  lines.push("# Protocol Gate");
  lines.push("These are hard collaboration rules. You MUST obey them.");
  lines.push("");

  // Group by source
  const bySource = new Map<string, ProtocolRule[]>();
  for (const r of gate.rules) {
    const list = bySource.get(r.source) ?? [];
    list.push(r);
    bySource.set(r.source, list);
  }

  const labels: Record<string, string> = {
    "pinned-memory": "Pinned Rules",
    "peer-contract": "Contract Constraints",
    "resource-claim": "Resource Ownership",
    "sync-gate": "Sync Gates (BLOCKING)",
    "checkpoint-review": "Checkpoint Reviews",
    "review": "Pending Reviews",
    "wake": "Queued Actions",
    "assignment": "Assignment State",
    "projection": "Projected Reality Rules",
  };

  for (const [source, rules] of bySource) {
    lines.push(`## ${labels[source] ?? source}`);
    for (const r of rules) {
      const marker = r.severity === "hard" ? "⛔" : r.severity === "soft" ? "⚠" : "ℹ";
      lines.push(`- ${marker} ${r.summary}`);
    }
    lines.push("");
  }

  if (gate.blocked) {
    lines.push("**⛔ BLOCKED — resolve hard blockers before proceeding.**");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format snapshot validation as a prompt section.
 */
export function formatValidationNotes(validation: SnapshotValidation): string {
  if (validation.notes.length === 0) return "";

  const lines: string[] = [];
  lines.push("# Validation Notes");
  for (const n of validation.notes) {
    lines.push(`- ${n}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Format the snapshot as the main working context prompt section.
 */
export function formatSnapshotReality(snapshot: ContextSnapshot | null): string {
  if (!snapshot) return "";

  const p = snapshot.payload ?? {};
  const s = (k: string) => {
    const v = (p as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v.join(", ");
    return typeof v === "string" ? v : "";
  };

  const lines: string[] = [];
  lines.push("# Snapshot Reality");
  lines.push("This is your current task working memory. Act on this.");
  lines.push("");

  if (s("intentScope")) lines.push(`**Intent scope**: ${s("intentScope")}`);
  if (s("goal")) lines.push(`**Goal**: ${s("goal")}`);
  if (s("currentPhase")) lines.push(`**Phase**: ${s("currentPhase")}`);
  if (s("nonGoals")) lines.push(`**Non-goals**: ${s("nonGoals")}`);
  if (s("verifiedFacts")) lines.push(`**Verified facts**: ${s("verifiedFacts")}`);
  if (s("unverifiedClaims")) lines.push(`**Unverified claims**: ${s("unverifiedClaims")}`);
  if (s("confirmedDecisions")) lines.push(`**Decisions**: ${s("confirmedDecisions")}`);
  if (s("activeConstraints")) lines.push(`**Active constraints**: ${s("activeConstraints")}`);
  if (s("workingResources")) lines.push(`**Working resources**: ${s("workingResources")}`);
  if (s("completedWork")) lines.push(`**Done**: ${s("completedWork")}`);
  if (s("remainingWork")) lines.push(`**Remaining**: ${s("remainingWork")}`);
  if (s("nextSteps")) lines.push(`**Next steps**: ${s("nextSteps")}`);
  if (s("risks")) lines.push(`**Risks**: ${s("risks")}`);
  if (s("blockers")) lines.push(`**Blockers**: ${s("blockers")}`);
  if (s("doNotTouch")) lines.push(`**Do not touch**: ${s("doNotTouch")}`);
  lines.push("");

  if (s("resumePrompt")) {
    lines.push("## Resume Instructions");
    lines.push(s("resumePrompt"));
    lines.push("");
  }

  if (s("handoffInstructions")) {
    lines.push("## Handoff Instructions");
    lines.push(s("handoffInstructions"));
    lines.push("");
  }

  return lines.join("\n");
}

