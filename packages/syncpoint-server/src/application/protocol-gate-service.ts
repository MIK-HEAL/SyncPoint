/**
 * Protocol Gate & Capsule Validation — P12 context assembly layer.
 *
 * Design principle:
 *   capsule-only means agent working-context only, not protocol-only.
 *   Protocol rules are never absorbed into capsule — they remain a hard external layer.
 *
 * Three layers:
 *   1. Protocol Gate   — hard collaboration rules
 *   2. Capsule Reality  — agent's current task working memory
 *   3. Validation Notes — staleness, evidence coverage, missing proof
 */

import type {
  ProtocolRule,
  ProtocolGateSummary,
  CapsuleValidation,
  ContextCapsule,
  Checkpoint,
  PeerContract,
} from "syncpoint-core";
import { ContractStatus, SyncTransactionStatus } from "syncpoint-core";
import * as repo from "../repositories.js";
import { sgCheckAgent } from "./sync-gate-service.js";
import { fcDetectConflicts } from "./file-claim-service.js";
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
  const pinned = repo.collectPinnedMemories(taskId);
  for (const m of pinned) {
    rules.push({
      source: "pinned-memory",
      severity: "hard",
      summary: `${m.key}: ${m.content}`,
    });
  }

  // 2. Peer contract constraints
  const approved = repo.getContractForTask(taskId);
  if (approved && approved.status === ContractStatus.APPROVED) {
    if (approved.scope) {
      rules.push({ source: "peer-contract", severity: "hard", summary: `Scope: ${approved.scope}`, entityId: approved.id });
    }
    if (approved.fileBoundaries) {
      rules.push({ source: "peer-contract", severity: "hard", summary: `File boundaries: ${approved.fileBoundaries}`, entityId: approved.id });
    }
    if (approved.responsibilities) {
      rules.push({ source: "peer-contract", severity: "soft", summary: `Responsibilities: ${approved.responsibilities}`, entityId: approved.id });
    }
    if (approved.interfaceSpec) {
      rules.push({ source: "peer-contract", severity: "soft", summary: `Interface: ${approved.interfaceSpec}`, entityId: approved.id });
    }
  }

  // 3. File claims for this agent
  const claims = repo.listActiveFileClaims(sessionId);
  const agentClaims = claims.filter((c: any) => c.agentId === agentId);
  for (const c of agentClaims) {
    rules.push({
      source: "file-claim",
      severity: "info",
      summary: `Claimed: ${c.paths} (${c.mode ?? "exclusive"})`,
      entityId: c.id,
    });
  }

  // 4. File conflicts
  const conflicts = fcDetectConflicts(sessionId);
  const agentConflicts = conflicts.filter((c: any) => c.claimA.agentId === agentId || c.claimB.agentId === agentId);
  for (const c of agentConflicts) {
    rules.push({
      source: "file-claim",
      severity: c.isHardConflict ? "hard" : "soft",
      summary: `Conflict on ${c.overlappingPath}: ${c.claimA.agentId} vs ${c.claimB.agentId}`,
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

  // 6. Active sync transactions
  const TX_BLOCKING: Set<string> = new Set([
    SyncTransactionStatus.OPEN,
    SyncTransactionStatus.WAITING_APPROVAL,
    SyncTransactionStatus.REJECTED,
  ]);
  try {
    const txns = repo.listActiveSyncTransactions({ taskId, sessionId });
    for (const tx of txns) {
      const isBlocking = TX_BLOCKING.has(tx.status as string);
      rules.push({
        source: "sync-transaction",
        severity: isBlocking ? "hard" : "soft",
        summary: `SyncTransaction ${tx.id}: ${tx.status}`,
        entityId: tx.id,
      });
    }
  } catch { /* no sync transactions module — ok */ }

  // 7. Pending reviews
  try {
    const reviews = (repo as any).listReviewRequests?.(sessionId) ?? [];
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
  const hasActiveSubmittedTx = rules.some(r => r.source === "sync-transaction" && r.severity === "hard");
  const blocked = hasBlockingGates || hasHardConflicts || hasActiveSubmittedTx;

  return {
    rules,
    blocked,
    hardBlockers,
    counts: {
      pinnedRules: pinned.length,
      contractConstraints: rules.filter(r => r.source === "peer-contract").length,
      fileClaims: agentClaims.length,
      activeGates: gateCheck.blockingGates.length,
      activeTransactions: rules.filter(r => r.source === "sync-transaction").length,
      pendingReviews: rules.filter(r => r.source === "review").length,
      pendingWakes: rules.filter(r => r.source === "wake").length,
    },
  };
}

// ══════════════════════════════════════════════════════
// Capsule Validation
// ══════════════════════════════════════════════════════

/**
 * Validate a capsule against the current state.
 * Returns a validation result with notes.
 */
export function validateCapsule(
  capsule: ContextCapsule | null | undefined,
  checkpoint: Checkpoint | null | undefined,
  taskId: string,
  agentId: string,
): CapsuleValidation {
  const notes: string[] = [];
  let valid = true;
  let stale = false;
  let staleReason: string | null = null;
  let scopeMatch = true;
  let hasBlockers = false;
  let hasEvidence = !!checkpoint;
  let needsSync = false;

  if (!capsule) {
    valid = false;
    notes.push("No context capsule found. Create one before resuming.");
    return {
      valid, stale, staleReason, scopeMatch, hasBlockers,
      hasEvidence, needsSync, notes,
    };
  }

  // Scope check
  if (capsule.taskId !== taskId || capsule.agentId !== agentId) {
    scopeMatch = false;
    valid = false;
    notes.push("Capsule scope mismatch: taskId or agentId does not match.");
  }

  // Staleness check
  if (checkpoint && capsule.createdAt < checkpoint.createdAt) {
    stale = true;
    staleReason = `Capsule (${capsule.createdAt}) is older than checkpoint (${checkpoint.createdAt}).`;
    valid = false;
    notes.push(`Stale: ${staleReason}`);
  }

  // Evidence check
  if (!checkpoint) {
    hasEvidence = false;
    valid = false;
    notes.push("No checkpoint found — capsule has no evidence backing.");
  }

  // Blocker check
  if (capsule.blockers && capsule.blockers.trim().length > 0) {
    hasBlockers = true;
    valid = false;
    notes.push(`Unresolved blockers: ${capsule.blockers.slice(0, 100)}`);
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
    "file-claim": "File Ownership",
    "sync-gate": "Sync Gates (BLOCKING)",
    "sync-transaction": "Sync Transactions",
    "review": "Pending Reviews",
    "wake": "Queued Actions",
    "assignment": "Assignment State",
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
 * Format capsule validation as a prompt section.
 */
export function formatValidationNotes(validation: CapsuleValidation): string {
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
 * Format the capsule as the main working context prompt section.
 */
export function formatCapsuleReality(capsule: ContextCapsule | null): string {
  if (!capsule) return "";

  const lines: string[] = [];
  lines.push("# Capsule Reality");
  lines.push("This is your current task working memory. Act on this.");
  lines.push("");

  if (capsule.intentScope) lines.push(`**Intent scope**: ${capsule.intentScope}`);
  if (capsule.goal) lines.push(`**Goal**: ${capsule.goal}`);
  if (capsule.currentPhase) lines.push(`**Phase**: ${capsule.currentPhase}`);
  if (capsule.nonGoals) lines.push(`**Non-goals**: ${capsule.nonGoals}`);
  if (capsule.verifiedFacts) lines.push(`**Verified facts**: ${capsule.verifiedFacts}`);
  if (capsule.unverifiedClaims) lines.push(`**Unverified claims**: ${capsule.unverifiedClaims}`);
  if (capsule.confirmedDecisions) lines.push(`**Decisions**: ${capsule.confirmedDecisions}`);
  if (capsule.activeConstraints) lines.push(`**Active constraints**: ${capsule.activeConstraints}`);
  if (capsule.workingFiles) lines.push(`**Working files**: ${capsule.workingFiles}`);
  if (capsule.completedWork) lines.push(`**Done**: ${capsule.completedWork}`);
  if (capsule.remainingWork) lines.push(`**Remaining**: ${capsule.remainingWork}`);
  if (capsule.nextSteps) lines.push(`**Next steps**: ${capsule.nextSteps}`);
  if (capsule.risks) lines.push(`**Risks**: ${capsule.risks}`);
  if (capsule.blockers) lines.push(`**Blockers**: ${capsule.blockers}`);
  if (capsule.doNotTouch) lines.push(`**Do not touch**: ${capsule.doNotTouch}`);
  lines.push("");

  if (capsule.resumePrompt) {
    lines.push("## Resume Instructions");
    lines.push(capsule.resumePrompt);
    lines.push("");
  }

  if (capsule.handoffInstructions) {
    lines.push("## Handoff Instructions");
    lines.push(capsule.handoffInstructions);
    lines.push("");
  }

  return lines.join("\n");
}
