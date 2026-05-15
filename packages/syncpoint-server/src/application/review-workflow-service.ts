/**
 * Review Workflow Service — checklist, evidence, change request, approval gate use cases.
 * Builds on top of v0.7 orchestration-service. CLI, MCP, and tRPC all share this layer.
 */

import {
  ChecklistItemStatus,
  ChangeRequestStatus,
  evaluateApprovalGate,
  ApprovalGateStatus,
  ReviewRequestStatus,
} from "syncpoint-core";
import type {
  ReviewChecklistItem,
  ReviewChecklistItemCreate,
  ReviewEvidence,
  ReviewEvidenceCreate,
  ChangeRequest,
  ChangeRequestCreate,
  ApprovalRecord,
  ApprovalGateResult,
  EvidenceKind,
  ReviewRequest,
  ReviewDecision,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { prepareContext } from "./context-policy-service.js";
import { orchSubmitReview } from "./orchestration-service.js";
import type { PreparedContext } from "syncpoint-core";

// ── Input Types ──────────────────────────────────────

export interface AddChecklistItemInput {
  reviewRequestId: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface AddEvidenceInput {
  reviewRequestId: string;
  kind: EvidenceKind;
  title: string;
  content: string;
  metadataJson?: string;
  createdBy?: string;
}

export interface RequestChangesInput {
  reviewRequestId: string;
  summary: string;
  items?: string;
  requestedBy?: string;
}

export interface AddressChangeInput {
  changeRequestId: string;
  evidenceId?: string;
  addressedBy?: string;
}

export interface ApproveReviewInput {
  reviewRequestId: string;
  summary: string;
  decidedBy?: string;
}

export interface BlockReviewInput {
  reviewRequestId: string;
  summary: string;
  requestedChanges?: string;
  decidedBy?: string;
}

export interface WaiveGateInput {
  reviewRequestId: string;
  reason: string;
  decidedBy?: string;
}

export interface ReviewPacket {
  reviewRequest: ReturnType<typeof repo.getReviewRequest>;
  checklistItems: ReviewChecklistItem[];
  evidence: ReviewEvidence[];
  changeRequests: ChangeRequest[];
  approvalRecords: ApprovalRecord[];
  gate: ApprovalGateResult;
  context?: PreparedContext;
}

export interface ReviewApprovalResult {
  approvalRecord: ApprovalRecord;
  gate: ApprovalGateResult;
  reviewDecision: ReviewDecision;
  reviewRequest: ReviewRequest;
}

export interface ReviewBlockResult {
  approvalRecord: ApprovalRecord;
  reviewDecision: ReviewDecision;
  reviewRequest: ReviewRequest;
  changeRequest?: ChangeRequest;
}

// ── Use Cases ────────────────────────────────────────

function ensureReviewInProgress(reviewRequestId: string): ReviewRequest {
  const rr = repo.getReviewRequest(reviewRequestId);
  if (rr.status === ReviewRequestStatus.PENDING) {
    return repo.updateReviewRequestStatus(reviewRequestId, ReviewRequestStatus.IN_PROGRESS);
  }
  if (rr.status !== ReviewRequestStatus.IN_PROGRESS) {
    throw new Error(`Review request must be IN_PROGRESS to decide; current status is ${rr.status}`);
  }
  return rr;
}

/**
 * Create a checklist item for a review request.
 */
export function rwCreateChecklistItem(input: AddChecklistItemInput): ReviewChecklistItem {
  repo.getReviewRequest(input.reviewRequestId);
  return repo.createChecklistItem({
    reviewRequestId: input.reviewRequestId,
    title: input.title,
    description: input.description,
    required: input.required,
  });
}

/**
 * List checklist items for a review request.
 */
export function rwListChecklist(reviewRequestId: string): ReviewChecklistItem[] {
  return repo.listChecklistItems(reviewRequestId);
}

/**
 * Update a checklist item status (pass / fail / waive / re-open).
 */
export function rwUpdateChecklistItem(
  itemId: string,
  status: ChecklistItemStatus,
  opts?: { notes?: string; updatedBy?: string },
): ReviewChecklistItem {
  return repo.updateChecklistItemStatus(itemId, status, opts);
}

/**
 * Add evidence to a review request.
 */
export function rwAddEvidence(input: AddEvidenceInput): ReviewEvidence {
  repo.getReviewRequest(input.reviewRequestId);
  return repo.createEvidence({
    reviewRequestId: input.reviewRequestId,
    kind: input.kind,
    title: input.title,
    content: input.content,
    metadataJson: input.metadataJson,
    createdBy: input.createdBy,
  });
}

/**
 * List evidence for a review request.
 */
export function rwListEvidence(reviewRequestId: string): ReviewEvidence[] {
  return repo.listEvidence(reviewRequestId);
}

/**
 * Request changes — creates a change request, blocks approval gate.
 */
export function rwRequestChanges(input: RequestChangesInput): ChangeRequest {
  repo.getReviewRequest(input.reviewRequestId);
  return repo.createChangeRequest({
    reviewRequestId: input.reviewRequestId,
    summary: input.summary,
    items: input.items,
    requestedBy: input.requestedBy,
  });
}

/**
 * Address a change request — marks it as ADDRESSED, optionally links evidence.
 */
export function rwAddressChange(input: AddressChangeInput): ChangeRequest {
  return repo.updateChangeRequestStatus(
    input.changeRequestId,
    ChangeRequestStatus.ADDRESSED,
    { evidenceId: input.evidenceId, addressedBy: input.addressedBy },
  );
}

/**
 * List change requests for a review.
 */
export function rwListChangeRequests(reviewRequestId: string): ChangeRequest[] {
  return repo.listChangeRequests(reviewRequestId);
}

/**
 * Evaluate the approval gate for a review request (computed, not persisted).
 */
export function rwEvaluateGate(reviewRequestId: string): ApprovalGateResult {
  const items = repo.listChecklistItems(reviewRequestId);
  const evidence = repo.listEvidence(reviewRequestId);
  const changes = repo.listChangeRequests(reviewRequestId);
  const openChanges = changes.filter(c => c.status === ChangeRequestStatus.OPEN).length;
  return evaluateApprovalGate(items, evidence.length, openChanges);
}

/**
 * Approve a review — creates approval record, verifies gate is PASSED.
 */
export function rwApproveReview(input: ApproveReviewInput): {
  approvalRecord: ApprovalRecord;
  gate: ApprovalGateResult;
  reviewDecision: ReviewDecision;
  reviewRequest: ReviewRequest;
} {
  const gate = rwEvaluateGate(input.reviewRequestId);
  if (gate.status !== ApprovalGateStatus.PASSED) {
    throw new Error(`Cannot approve: gate is ${gate.status}. Reasons: ${gate.reasons.join("; ")}`);
  }
  ensureReviewInProgress(input.reviewRequestId);

  const reviewResult = orchSubmitReview({
    reviewRequestId: input.reviewRequestId,
    verdict: "approved",
    summary: input.summary,
    decidedBy: input.decidedBy,
  });

  const record = repo.createApprovalRecord({
    reviewRequestId: input.reviewRequestId,
    decision: "approved",
    summary: input.summary,
    decidedBy: input.decidedBy,
  });

  return {
    approvalRecord: record,
    gate,
    reviewDecision: reviewResult.decision,
    reviewRequest: reviewResult.reviewRequest,
  };
}

/**
 * Block a review — creates approval record with 'blocked' decision + optional change request.
 */
export function rwBlockReview(input: BlockReviewInput): {
  approvalRecord: ApprovalRecord;
  reviewDecision: ReviewDecision;
  reviewRequest: ReviewRequest;
  changeRequest?: ChangeRequest;
} {
  ensureReviewInProgress(input.reviewRequestId);

  const reviewResult = orchSubmitReview({
    reviewRequestId: input.reviewRequestId,
    verdict: input.requestedChanges ? "request-changes" : "rejected",
    summary: input.summary,
    requestedChanges: input.requestedChanges,
    decidedBy: input.decidedBy,
  });

  const record = repo.createApprovalRecord({
    reviewRequestId: input.reviewRequestId,
    decision: "blocked",
    summary: input.summary,
    requestedChanges: input.requestedChanges,
    decidedBy: input.decidedBy,
  });

  let changeRequest: ChangeRequest | undefined;
  if (input.requestedChanges) {
    changeRequest = repo.createChangeRequest({
      reviewRequestId: input.reviewRequestId,
      summary: input.requestedChanges,
      requestedBy: input.decidedBy,
    });
  }

  return {
    approvalRecord: record,
    reviewDecision: reviewResult.decision,
    reviewRequest: reviewResult.reviewRequest,
    changeRequest,
  };
}

/**
 * Waive the approval gate — creates approval record with 'waived' decision.
 */
export function rwWaiveGate(input: WaiveGateInput): ApprovalRecord {
  return repo.createApprovalRecord({
    reviewRequestId: input.reviewRequestId,
    decision: "waived",
    summary: "Gate waived",
    waiverReason: input.reason,
    decidedBy: input.decidedBy,
  });
}

/**
 * Prepare a full review packet — everything a reviewer needs.
 */
export function rwPrepareReviewPacket(reviewRequestId: string): ReviewPacket {
  const rr = repo.getReviewRequest(reviewRequestId);
  const checklistItems = repo.listChecklistItems(reviewRequestId);
  const evidence = repo.listEvidence(reviewRequestId);
  const changeRequests = repo.listChangeRequests(reviewRequestId);
  const approvalRecords = repo.listApprovalRecords(reviewRequestId);
  const openChanges = changeRequests.filter(c => c.status === ChangeRequestStatus.OPEN).length;
  const gate = evaluateApprovalGate(checklistItems, evidence.length, openChanges);

  let context: PreparedContext | undefined;
  try {
    context = prepareContext({
      intent: "review",
      role: "reviewer",
      taskId: rr.taskId,
      agentId: rr.reviewerAgentId,
    });
  } catch {
    // Context preparation may fail if no checkpoint/snapshot exists yet
  }

  return {
    reviewRequest: rr,
    checklistItems,
    evidence,
    changeRequests,
    approvalRecords,
    gate,
    context,
  };
}
