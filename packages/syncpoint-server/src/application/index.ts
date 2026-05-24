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
  MissingValidatorError,
  UnknownValidatorTypeError,
  pmSupersede,
  pmGetVersion,
  pmCheckDuplicate,
} from "./project-memory-service.js";

export type {
  ProjectMemoryAddInput,
  ProjectMemoryExportResult,
} from "./project-memory-service.js";

// P3A Projection + PR3 Cache
export {
  buildProjection,
  getProjectionCacheStats,
  clearProjectionCache,
  setProjectionCacheMaxSize,
} from "./reality-projection-service.js";

export type {
  ProjectionCacheStats,
} from "./reality-projection-service.js";

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
  ensureApplicationBootstrap,
  getApplicationBootstrapStatus,
  resetApplicationBootstrapForTest,
} from "./bootstrap.js";

export type {
  ApplicationBootstrapPluginStatus,
  ApplicationBootstrapStatus,
} from "./bootstrap.js";

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

// ResourceClaim (generic)
export {
  rcClaim,
  rcRelease,
  rcList,
  rcDetectConflicts,
} from "./resource-claim-service.js";

export type {
  ClaimResourcesInput,
  ClaimResourcesResult,
  ListResourceClaimsInput,
} from "./resource-claim-service.js";


// SyncGate
export {
  sgRequest,
  sgAck,
  sgResolve,
  sgCancel,
  sgStatus,
  sgStatusDetailed,
  sgList,
  sgListActive,
  sgCheckAgent,
  sgVote,
  sgReconcileActive,
} from "./sync-gate-service.js";

export type {
  SyncGateRequestInput,
  SyncGateStatusResult,
  AgentBlockCheck,
} from "./sync-gate-service.js";

// FileAudit
export {
  auditFileChange,
  fileAuditListActiveFileClaims,
} from "./file-audit-service.js";

export type {
  AuditFileChangeInput,
  AuditFileChangeResult,
} from "./file-audit-service.js";

// WritePermit / controlled writes
export {
  writeCheck,
  writePrepare,
  writeApply,
} from "./write-permit-service.js";

export type {
  WriteCheckInput,
  WritePrepareInput,
  WriteApplyInput,
  WriteCheckResult,
  WritePrepareResult,
  WriteApplyResult,
  FileMutation,
} from "./write-permit-service.js";

export {
  guardStatus,
  guardCreateSession,
  guardValidateToken,
  guardRevokeSession,
} from "./guard-session-service.js";

export type {
  GuardCreateSessionInput,
  GuardMode,
  GuardProxyAdapter,
  GuardSession,
  GuardSessionStatus,
  GuardStatusResult,
  GuardValidateTokenResult,
} from "./guard-session-service.js";

// Backing Store Reconciliation
export {
  reconcileBackingStore,
  recordAuthorizedWrite,
} from "./backing-store-reconciliation-service.js";

// File Permission Guard
export {
  lockClaimedFiles,
  unlockClaimedFiles,
  refreshGuardLocks,
  isGuardActive,
} from "./file-permission-guard.js";

export type {
  ReconcileInput,
  ReconcileResult,
  ReconcileFileResult,
} from "./backing-store-reconciliation-service.js";

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
} from "./checkpoint-review-service.js";

export type {
  SyncTxCreateInput,
  SyncTxStatusResult,
} from "./checkpoint-review-service.js";

// Operation (generic)
export {
  opCreate,
  opSubmit,
  opCheck,
  opApprove,
  opReject,
  opApply,
  opCancel,
  opStatus,
  opList,
} from "./operation-service.js";

export type {
  OperationCreateInput,
  OperationStatusResult,
} from "./operation-service.js";


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
export { constraintCheck } from "./constraint-evaluation-service.js";

export type {
  ConstraintCheckAction,
  ConstraintRuntimeCheckInput,
  ConstraintRuntimeView,
  ConstraintViolationView,
} from "./constraint-evaluation-service.js";

// Protocol Gate & Snapshot Validation (P12)
export {
  assembleProtocolGate,
  injectProjectionIntoGate,
  validateSnapshot,
  formatProtocolGatePrompt,
  formatValidationNotes,
  formatSnapshotReality,
} from "./protocol-gate-service.js";

// Negotiation Protocol
export {
  negStart,
  negMessage,
  negReconcile,
  negResolve,
  negEscalate,
  negStatus,
} from "./negotiation-service.js";

// Agent Manifest + Escalation Routing
export {
  manifestUpsert,
  manifestGet,
  manifestList,
  manifestDelete,
  routeGateEscalation,
} from "./escalation-routing-service.js";
