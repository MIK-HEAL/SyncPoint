/**
 * Application use cases — the single source of orchestration logic.
 * CLI, MCP, and tRPC all call these functions.
 */

export {
  loopBoot,
  loopResume,
  loopCheckpoint,
  loopHandoff,
  loopStatus,
  LoopError,
  EXIT,
} from "./loop-service.js";

export {
  pmAdd,
  pmGet,
  pmUpdate,
  pmApprove,
  pmDeprecate,
  pmList,
  pmSearch,
  pmExport,
  ProjectMemoryPathError,
  CallerIdentityError,
  DuplicateMemoryError,
  InvalidProjectionError,
  pmSupersede,
  pmGetVersion,
  pmCheckDuplicate,
} from "./project-memory-service.js";

export type {
  ProjectMemoryAddInput,
  ProjectMemoryExportResult,
} from "./project-memory-service.js";

// P3A Projection
export { buildProjection } from "./projection-service.js";

export type {
  LoopBootInput,
  LoopBootResult,
  LoopResumeInput,
  LoopResumeResult,
  LoopCheckpointInput,
  LoopCheckpointResult,
  LoopHandoffInput,
  LoopHandoffResult,
  LoopStatusInput,
  LoopStatusResult,
} from "./loop-service.js";

export {
  prepareContext,
  enforcePreparedContext,
  getContextPolicyInfo,
} from "./context-policy-service.js";

export type {
  PrepareContextInput,
  ContextPolicyInfo,
} from "./context-policy-service.js";

export {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchCompleteAssignment,
  orchRequestReview,
  orchStartReview,
  orchSubmitReview,
  orchGetSessionStatus,
  orchAdvanceSession,
  orchPrepareReviewContext,
  orchCancelSession,
} from "./orchestration-service.js";

export type {
  CreateSessionInput,
  CreateSessionResult,
  AssignRoleInput,
  PlanTaskInput,
  RequestReviewInput,
  SubmitReviewInput,
  SessionStatusResult,
  AdvanceSessionResult,
} from "./orchestration-service.js";

export {
  rwCreateChecklistItem,
  rwListChecklist,
  rwUpdateChecklistItem,
  rwAddEvidence,
  rwListEvidence,
  rwRequestChanges,
  rwAddressChange,
  rwListChangeRequests,
  rwEvaluateGate,
  rwApproveReview,
  rwBlockReview,
  rwWaiveGate,
  rwPrepareReviewPacket,
} from "./review-workflow-service.js";

export type {
  AddChecklistItemInput,
  AddEvidenceInput,
  RequestChangesInput,
  AddressChangeInput,
  ApproveReviewInput,
  BlockReviewInput,
  WaiveGateInput,
  ReviewPacket,
  ReviewApprovalResult,
  ReviewBlockResult,
} from "./review-workflow-service.js";

export {
  pbGetNextAction,
  pbCaptureEvidence,
  pbGetActiveSession,
} from "./playbook-service.js";

export type {
  NextActionInput,
  NextActionResult,
  CaptureEvidenceInput,
  CaptureEvidenceResult,
  ActiveSessionResult,
} from "./playbook-service.js";

// Wake Engine
export {
  wakeEngineStart,
  wakeEngineStop,
  wakeEngineStats,
  processOrchestrationEvent,
  wakeList,
  wakeGet,
  wakeAck,
  wakeStart,
  wakeDone,
  wakeFail,
  wakeSkip,
  wakeNext,
} from "./wake-engine-service.js";

export type {
  WakeEngineOptions,
  WakeEngineStats,
  WakeListInput,
} from "./wake-engine-service.js";

// FileClaim / Conflict Awareness
export {
  fcClaimFiles,
  fcReleaseClaim,
  fcListClaims,
  fcDetectConflicts,
} from "./file-claim-service.js";

export type {
  ClaimFilesInput,
  ClaimFilesResult,
  ListClaimsInput,
} from "./file-claim-service.js";

// SyncGate
export {
  sgRequest,
  sgAck,
  sgResolve,
  sgCancel,
  sgStatus,
  sgList,
  sgListActive,
  sgCheckAgent,
} from "./sync-gate-service.js";

export type {
  SyncGateRequestInput,
  SyncGateStatusResult,
  AgentBlockCheck,
} from "./sync-gate-service.js";

// SyncTransaction
export {
  stxCreate,
  stxApprove,
  stxReject,
  stxResolve,
  stxCancel,
  stxStatus,
  stxList,
  stxListActive,
} from "./sync-transaction-service.js";

export type {
  SyncTxCreateInput,
  SyncTxStatusResult,
} from "./sync-transaction-service.js";

// PatchProposal
export {
  ppPropose,
  ppSubmit,
  ppCheck,
  ppApprove,
  ppReject,
  ppApply,
  ppCancel,
  ppStatus,
  ppList,
} from "./patch-proposal-service.js";

export type {
  PatchProposeInput,
  PatchStatusResult,
} from "./patch-proposal-service.js";

// SyncStatus (read-model / aggregation)
export {
  buildOverview,
  buildSnapshot,
  buildScopeFilter,
  classifyBlockers,
} from "./sync-status-service.js";

export type {
  OverviewInput,
  SnapshotInput,
  UnifiedBlocker,
} from "./sync-status-service.js";

// P4D Constraint Runtime (read-only visibility)
export { constraintCheck } from "./constraint-runtime-service.js";

export type {
  ConstraintCheckAction,
  ConstraintRuntimeCheckInput,
  ConstraintRuntimeView,
  ConstraintViolationView,
} from "./constraint-runtime-service.js";

// Protocol Gate & Capsule Validation (P12)
export {
  assembleProtocolGate,
  injectProjectionIntoGate,
  validateCapsule,
  formatProtocolGatePrompt,
  formatValidationNotes,
  formatCapsuleReality,
} from "./protocol-gate-service.js";
