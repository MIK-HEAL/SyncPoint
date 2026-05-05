/**
 * PatchProposal Service — patch submission, checking, approval, and application.
 *
 * Use cases:
 *   ppPropose  — create a draft patch proposal
 *   ppSubmit   — submit for checking (DRAFT → SUBMITTED)
 *   ppCheck    — run ownership/conflict checks
 *   ppApprove  — approve a submitted patch
 *   ppReject   — reject a submitted patch
 *   ppApply    — mark an approved patch as applied
 *   ppCancel   — cancel a patch proposal
 *   ppStatus   — get proposal with check result
 *   ppList     — list proposals with filters
 */

import {
  PatchProposalStatus,
  validatePatchTransition,
  extractTouchedFiles,
  runPatchChecks,
  evaluateConstraints,
  EventType,
  filePathsToResourceRefs,
} from "syncpoint-core";
import type { PatchProposal, PatchCheckResult } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent } from "../repositories/_shared.js";
import { buildProjection } from "./projection-service.js";

// ── Types ──────────────────────────────────────────────

export interface PatchProposeInput {
  sessionId: string;
  taskId: string;
  agentId: string;
  title: string;
  summary?: string;
  patchText: string;
}

export interface PatchStatusResult {
  proposal: PatchProposal;
  checkResult: PatchCheckResult | null;
}

// ── Use Cases ──────────────────────────────────────────

/**
 * Create a draft patch proposal.
 */
export function ppPropose(input: PatchProposeInput): PatchProposal {
  const proposal = repo.createPatchProposal({
    sessionId: input.sessionId,
    taskId: input.taskId,
    agentId: input.agentId,
    title: input.title,
    summary: input.summary ?? "",
    patchText: input.patchText,
  });

  // Extract touched files
  const touchedFiles = extractTouchedFiles(input.patchText);
  const updated = repo.updatePatchProposal(proposal.id, {
    touchedFiles: touchedFiles.join(","),
  });

  logEvent(
    EventType.PATCH_PROPOSED,
    "patch_proposal",
    updated.id,
    JSON.stringify({ title: input.title, touchedFiles }),
  );

  // Dual-write: mirror to generic operation table
  try {
    repo.createOperation({
      type: "code_patch",
      actorId: input.agentId,
      taskId: input.taskId,
      sessionId: input.sessionId,
      title: input.title,
      summary: input.summary ?? "",
      targetResources: filePathsToResourceRefs(touchedFiles.join(",")),
      payloadRef: "",
    });
  } catch { /* best-effort mirror */ }

  return updated;
}

/**
 * Submit a draft patch for checking (DRAFT → SUBMITTED).
 * Automatically runs checks.
 */
export function ppSubmit(patchId: string): PatchStatusResult {
  let proposal = repo.getPatchProposal(patchId);

  if (!validatePatchTransition(proposal.status as PatchProposalStatus, PatchProposalStatus.SUBMITTED)) {
    throw new Error(`Cannot submit patch ${patchId} from ${proposal.status}`);
  }

  proposal = repo.updatePatchProposal(patchId, {
    status: PatchProposalStatus.SUBMITTED,
  });

  logEvent(EventType.PATCH_SUBMITTED, "patch_proposal", patchId, "");

  // Auto-check
  return ppCheck(patchId);
}

/**
 * Run ownership/conflict checks on a patch proposal.
 */
export function ppCheck(patchId: string): PatchStatusResult {
  const proposal = repo.getPatchProposal(patchId);
  const touchedFiles = (proposal.touchedFiles || "").split(",").filter(Boolean);

  // Get agent's active claims and all active claims
  const agentClaims = repo.listFileClaims({ agentId: proposal.agentId, status: "ACTIVE" });
  const allActiveClaims = repo.listActiveFileClaims(proposal.sessionId || undefined);

  const checkResult = runPatchChecks({
    patchText: proposal.patchText,
    touchedFiles,
    agentId: proposal.agentId,
    agentClaims,
    allActiveClaims,
  });

  // P4B: Constraint Runtime enforcement — evaluate against projection
  try {
    const projection = buildProjection({
      taskId: proposal.taskId,
      workingFiles: touchedFiles,
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection,
      touchedFiles,
    });
    if (decision.blockers.length > 0) {
      checkResult.allPassed = false;
      checkResult.constraintViolations = decision.blockers.map(b => ({
        rule: b.rule,
        sourceMemoryId: b.sourceMemoryId,
        projectionId: b.projectionId,
        message: b.message,
        evidence: b.evidence,
      }));
      // Add a check item for each violation
      for (const v of decision.blockers) {
        checkResult.items.push({
          check: `constraint:${v.rule}`,
          passed: false,
          detail: v.message,
        });
      }
    }
  } catch (err) {
    // P4C: surface as observable warning instead of silent swallow
    checkResult.items.push({
      check: "constraint:runtime_unavailable",
      passed: true,
      detail: `Constraint runtime unavailable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Store check result and update related claim IDs
  const relatedClaimIds = agentClaims.map(c => c.id).join(",");
  let status = proposal.status;

  // Auto-move to CONFLICTING if checks fail and proposal is SUBMITTED
  if (!checkResult.allPassed && proposal.status === PatchProposalStatus.SUBMITTED) {
    status = PatchProposalStatus.CONFLICTING;
  }

  const updated = repo.updatePatchProposal(patchId, {
    checkResult: JSON.stringify(checkResult),
    relatedClaimIds,
    status,
  });

  logEvent(
    EventType.PATCH_CHECKED,
    "patch_proposal",
    patchId,
    JSON.stringify({ allPassed: checkResult.allPassed }),
  );

  return { proposal: updated, checkResult };
}

/**
 * Approve a submitted patch.
 */
export function ppApprove(patchId: string, agentId: string, summary?: string): PatchProposal {
  const proposal = repo.getPatchProposal(patchId);

  if (!validatePatchTransition(proposal.status as PatchProposalStatus, PatchProposalStatus.APPROVED)) {
    throw new Error(`Cannot approve patch ${patchId} from ${proposal.status}`);
  }

  const updated = repo.updatePatchProposal(patchId, {
    status: PatchProposalStatus.APPROVED,
    decisionSummary: summary ?? `Approved by ${agentId}`,
  });

  logEvent(
    EventType.PATCH_APPROVED,
    "patch_proposal",
    patchId,
    JSON.stringify({ agentId, summary: summary ?? "" }),
  );

  return updated;
}

/**
 * Reject a submitted patch.
 */
export function ppReject(patchId: string, agentId: string, reason?: string): PatchProposal {
  const proposal = repo.getPatchProposal(patchId);

  if (!validatePatchTransition(proposal.status as PatchProposalStatus, PatchProposalStatus.REJECTED)) {
    throw new Error(`Cannot reject patch ${patchId} from ${proposal.status}`);
  }

  const updated = repo.updatePatchProposal(patchId, {
    status: PatchProposalStatus.REJECTED,
    decisionSummary: reason ?? `Rejected by ${agentId}`,
  });

  logEvent(
    EventType.PATCH_REJECTED,
    "patch_proposal",
    patchId,
    JSON.stringify({ agentId, reason: reason ?? "" }),
  );

  return updated;
}

/**
 * Mark an approved patch as applied.
 */
export function ppApply(patchId: string): PatchProposal {
  const proposal = repo.getPatchProposal(patchId);

  if (!validatePatchTransition(proposal.status as PatchProposalStatus, PatchProposalStatus.APPLIED)) {
    throw new Error(`Cannot apply patch ${patchId} from ${proposal.status}`);
  }

  const updated = repo.updatePatchProposal(patchId, {
    status: PatchProposalStatus.APPLIED,
  });

  logEvent(EventType.PATCH_APPLIED, "patch_proposal", patchId, "");
  return updated;
}

/**
 * Cancel a patch proposal.
 */
export function ppCancel(patchId: string, reason?: string): PatchProposal {
  const proposal = repo.getPatchProposal(patchId);

  if (!validatePatchTransition(proposal.status as PatchProposalStatus, PatchProposalStatus.CANCELLED)) {
    throw new Error(`Cannot cancel patch ${patchId} from ${proposal.status}`);
  }

  const updated = repo.updatePatchProposal(patchId, {
    status: PatchProposalStatus.CANCELLED,
    decisionSummary: reason ?? "",
  });

  logEvent(EventType.PATCH_CANCELLED, "patch_proposal", patchId, reason ?? "");
  return updated;
}

/**
 * Get patch status with parsed check result.
 */
export function ppStatus(patchId: string): PatchStatusResult {
  const proposal = repo.getPatchProposal(patchId);
  let checkResult: PatchCheckResult | null = null;
  if (proposal.checkResult) {
    try { checkResult = JSON.parse(proposal.checkResult); } catch { /* invalid JSON */ }
  }
  return { proposal, checkResult };
}

/**
 * List patch proposals with optional filters.
 */
export function ppList(opts?: {
  sessionId?: string;
  taskId?: string;
  agentId?: string;
  status?: string;
}): PatchProposal[] {
  return repo.listPatchProposals(opts);
}
