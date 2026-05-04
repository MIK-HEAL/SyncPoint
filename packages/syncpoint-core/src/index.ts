/**
 * SyncPoint Core — public API.
 */

// States & protocol
export {
  AgentStatus,
  TaskStatus,
  HandoffStatus,
  ContractStatus,
  DiaryEntryType,
  EventType,
  AGENT_TRANSITIONS,
  TASK_TRANSITIONS,
  CONTRACT_TRANSITIONS,
  InvalidTransition,
  validateAgentTransition,
  validateTaskTransition,
  validateContractTransition,
} from "./states.js";

// Models & schemas
export {
  AgentSchema,
  AgentCreateSchema,
  TaskSchema,
  TaskCreateSchema,
  CheckpointSchema,
  CheckpointCreateSchema,
  DiaryEntrySchema,
  DiaryEntryCreateSchema,
  HandoffSchema,
  HandoffCreateSchema,
  PeerContractSchema,
  PeerContractCreateSchema,
  ContextCapsuleSchema,
  ContextCapsuleCreateSchema,
  EventSchema,
  StatusResponseSchema,
} from "./models.js";

// Types (re-exported from schemas)
export type {
  Agent,
  AgentCreate,
  Task,
  TaskCreate,
  Checkpoint,
  CheckpointCreate,
  DiaryEntry,
  DiaryEntryCreate,
  Handoff,
  HandoffCreate,
  PeerContract,
  PeerContractCreate,
  ContextCapsule,
  ContextCapsuleCreate,
  Event,
  StatusResponse,
} from "./models.js";

// Memory Switch Engine
export {
  PinnedMemorySchema,
  PinnedMemoryCreateSchema,
  QualityCheckStatus,
  QualityCheckResultSchema,
  ResumeContextSchema,
} from "./memory.js";

export type {
  PinnedMemory,
  PinnedMemoryCreate,
  QualityCheckResult,
  ResumeContext,
} from "./memory.js";

// Project Memory Layer
export {
  ProjectMemoryScope,
  ProjectMemoryCategory,
  ProjectMemoryStatus,
  ProjectMemoryConfidence,
  ProjectMemorySourceType,
  ProjectMemorySchema,
  ProjectMemoryCreateSchema,
  computeMemoryFingerprint,
  isMemoryDuplicate,
  // V2
  MemoryKind,
  ProjectionTarget,
  MemorySeverity,
  ValidityStatus,
  AppliesToSchema,
  ValiditySchema,
  defaultKindFromCategory,
  validProjectionTargets,
  isValidProjection,
} from "./project-memory.js";

export type {
  ProjectMemory,
  ProjectMemoryCreate,
  MemoryDedupResult,
  AppliesTo,
  Validity,
} from "./project-memory.js";

// P3A Projection Compiler
export {
  compileProjection,
  computeProjectionCacheKey,
  computeProjectionLookupKey,
  computeContentHash,
  resolveProjectionRoute,
} from "./projection.js";

export type {
  ProjectedReality,
  ProjectionItem,
  ProjectionScope,
  ProjectionConflict,
  ProjectionSource,
  CapsulePatch,
  ProjectionCreatedFrom,
  ProjectionValidityStatus,
  ProjectionInput,
  ProjectionContext,
  ProjectionRoute,
} from "./projection.js";

// P4A Constraint Runtime + PR4 Typed Validators
export {
  evaluateConstraints,
  parseRuntimeSpec,
  resolveRuntimeSpec,
} from "./constraint-runtime.js";

export type {
  RuntimeAction,
  ConstraintViolation,
  ConstraintDecision,
  ConstraintInput,
  ConstraintRuleType,
  ConstraintRuntimeSpec,
} from "./constraint-runtime.js";

// Prompt Template Engine
export { formatResumePrompt, formatProjectedReality } from "./prompt-templates.js";
export type { PromptFormat } from "./prompt-templates.js";

// Agent Adapter Protocol
export {
  AgentProvider,
  AdapterLifecycleEvent,
  AdapterInstructionSchema,
  ADAPTER_CONFIGS,
  buildAdapterInstruction,
  getAdapterConfig,
  listAdapterProviders,
} from "./adapter.js";

export type {
  AdapterInstruction,
  AdapterConfig,
} from "./adapter.js";

// Context Policy Layer
export {
  ContextIntent,
  ContextRole,
  ContextGateMode,
  ContextSection,
  ContextPolicySchema,
  ContextPolicyCheckSchema,
  PreparedContextSchema,
  CONTEXT_POLICIES,
  MODE_CONTEXT_OVERRIDES,
  getContextPolicy,
  getContextPolicyForMode,
  listContextIntents,
  listContextRoles,
} from "./context-policy.js";

export type {
  ContextPolicy,
  ContextPolicyCheck,
  PreparedContext,
  RelationshipModeStr,
} from "./context-policy.js";

// Orchestration Layer
export {
  OrchestratorRole,
  SessionStatus,
  ReviewVerdict,
  TaskAssignmentStatus,
  ReviewRequestStatus,
  RoleProfileSchema,
  RoleProfileCreateSchema,
  OrchestrationSessionSchema,
  OrchestrationSessionCreateSchema,
  TaskAssignmentSchema,
  TaskAssignmentCreateSchema,
  ReviewRequestSchema,
  ReviewRequestCreateSchema,
  ReviewDecisionSchema,
  ReviewDecisionCreateSchema,
  SESSION_TRANSITIONS,
  TASK_ASSIGNMENT_TRANSITIONS,
  REVIEW_REQUEST_TRANSITIONS,
  validateSessionTransition,
  validateTaskAssignmentTransition,
  validateReviewRequestTransition,
} from "./orchestration.js";

export type {
  RoleProfile,
  RoleProfileCreate,
  OrchestrationSession,
  OrchestrationSessionCreate,
  TaskAssignment,
  TaskAssignmentCreate,
  ReviewRequest,
  ReviewRequestCreate,
  ReviewDecision,
  ReviewDecisionCreate,
} from "./orchestration.js";

// Review Workflow Layer
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

// Playbook Engine
export {
  PlaybookActionKind,
  NextActionSchema,
  computeNextActions,
} from "./playbook-engine.js";

export type {
  NextAction,
  SessionSnapshot,
} from "./playbook-engine.js";

// Wake Engine
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

// FileClaim / Conflict Awareness
export {
  FileClaimStatus,
  FileClaimMode,
  FileClaimSchema,
  FileClaimCreateSchema,
  parseClaimPaths,
  pathsOverlap,
  detectConflicts,
} from "./file-claim.js";

export type {
  FileClaim,
  FileClaimCreate,
  FileConflict,
} from "./file-claim.js";

// SyncGate
export {
  SyncGateStatus,
  SyncGateReason,
  SYNC_GATE_TRANSITIONS,
  validateSyncGateTransition,
  SyncGateSchema,
  SyncGateCreateSchema,
  SyncGateAckSchema,
  parseIdList,
  allAcked,
  pendingAgents,
  isAgentBlocked,
} from "./sync-gate.js";

export type {
  SyncGate,
  SyncGateCreate,
  SyncGateAck,
} from "./sync-gate.js";

// Relationship Mode
export {
  RelationshipMode,
  RelationshipModeSchema,
  MODE_PHASE_FLOW,
  MODE_SYNC_RULES,
  MODE_WAKE_VERBS,
  REQUIRED_BEFORE_START,
  RECOMMENDED_ACTIONS,
  FORBIDDEN_ACTIONS,
  isValidWakeVerb,
  getSyncRules,
  getPhaseFlow,
  getModeDescription,
  isModeActionAllowed,
  getRequiredBeforeStart,
  getRecommendedActions,
  getForbiddenActions,
} from "./relationship-mode.js";

export type {
  ModeSyncRule,
  ModeActionVerdict,
} from "./relationship-mode.js";

// SyncTransaction
export {
  SyncTransactionStatus,
  SYNC_TX_TRANSITIONS,
  validateSyncTxTransition,
  SyncTransactionSchema,
  SyncTransactionCreateSchema,
  parseTxIdList,
  allApproved,
  hasRejection,
  pendingApprovers,
  isTxTerminal,
  isTxBlocking,
} from "./sync-transaction.js";

export type {
  SyncTransaction,
  SyncTransactionCreate,
} from "./sync-transaction.js";

// PatchProposal
export {
  PatchProposalStatus,
  validatePatchTransition,
  PatchProposalSchema,
  PatchProposalCreateSchema,
  extractTouchedFiles,
  isValidPatchFormat,
  findUncoveredFiles,
  findConflictingClaims,
  runPatchChecks,
} from "./patch-proposal.js";

export type {
  PatchProposal,
  PatchProposalCreate,
  PatchCheckItem,
  PatchCheckResult,
} from "./patch-proposal.js";

// Runtime Identity
export {
  RuntimeStatus,
  RuntimeKind,
  RuntimeSchema,
  RuntimeCreateSchema,
  resolveIdentity,
  IdentityConflictError,
} from "./runtime.js";

export type {
  Runtime,
  RuntimeCreate,
  BoundIdentity,
  IdentityEnv,
} from "./runtime.js";

// Capsule Dominant Context
export {
  ContextMode,
  DEFAULT_CONTEXT_MODE,
  ProtocolRuleSchema,
  ProtocolGateSummarySchema,
  CapsuleValidationSchema,
  CapsuleExtendedFieldsSchema,
} from "./capsule-context.js";

export type {
  ProtocolRule,
  ProtocolGateSummary,
  CapsuleValidation,
  CapsuleExtendedFields,
} from "./capsule-context.js";
