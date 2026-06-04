/**
 * SyncPoint governance layer — review, wake, constraint, and review-workflow surfaces.
 *
 * Phase 4: source files are now physically hosted here.
 * syncpoint-core retains copies for backward compatibility.
 */

// ── Checkpoint review ─────────────────────────────────
export {
  CheckpointReviewStatus,
  CHECKPOINT_REVIEW_TRANSITIONS,
  validateCheckpointReviewTransition,
  CheckpointReviewSchema,
  CheckpointReviewCreateSchema,
  allApproved,
  hasRejection,
  pendingApprovers,
  isReviewTerminal,
  isReviewBlocking,
} from "./checkpoint-review.js";
export type {
  CheckpointReview,
  CheckpointReviewCreate,
} from "./checkpoint-review.js";

// ── Constraint evaluation ─────────────────────────────
export {
  evaluateConstraints,
  buildConstraintManifest,
  resolveRuntimeSpec,
  registerConstraintEvaluator,
  getConstraintEvaluator,
  clearConstraintEvaluatorRegistry,
  isConstraintRuleKnown,
} from "./constraint-evaluation.js";
export type {
  ConstraintAction,
  ConstraintViolation,
  ConstraintDecision,
  ConstraintManifest,
  ConstraintInput,
  ConstraintRuleType,
  ConstraintRuleSpec,
  ConstraintEvaluator,
} from "./constraint-evaluation.js";

// ── Wake engine ──────────────────────────────────────
export {
  WakeRequestStatus,
  WAKE_REQUEST_TRANSITIONS,
  WakeRunnerMode,
  WakeRequestSchema,
  WakeRequestCreateSchema,
  OrchestrationEventType,
  DEFAULT_WAKE_RULES,
  SYNC_VERB_WHITELIST,
  computeWakeTargets,
  validateWakeRequestTransition,
} from "./wake.js";
export type {
  WakeRequest,
  WakeRequestCreate,
  WakeRule,
  WakeTarget,
  WakeContext,
} from "./wake.js";

// ── Review workflow ──────────────────────────────────
export {
  ChecklistItemStatus,
  CHECKLIST_ITEM_TRANSITIONS,
  validateChecklistItemTransition,
  EvidenceKind,
  ChangeRequestStatus,
  CHANGE_REQUEST_TRANSITIONS,
  validateChangeRequestTransition,
  ApprovalGateStatus,
  ApprovalRecordDecision,
  ReviewChecklistItemSchema,
  ReviewChecklistItemCreateSchema,
  ReviewEvidenceSchema,
  ReviewEvidenceCreateSchema,
  ChangeRequestSchema,
  ChangeRequestCreateSchema,
  ApprovalRecordSchema,
  ApprovalRecordCreateSchema,
  ApprovalGateResultSchema,
  evaluateApprovalGate,
} from "./review-workflow.js";
export type {
  ReviewChecklistItem,
  ReviewChecklistItemCreate,
  ReviewEvidence,
  ReviewEvidenceCreate,
  ChangeRequest,
  ChangeRequestCreate,
  ApprovalRecord,
  ApprovalRecordCreate,
  ApprovalGateResult,
} from "./review-workflow.js";
