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
  registerScopeMatcher,
  getScopeMatcher,
  clearScopeMatcherRegistry,
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
  ScopeMatcher,
} from "./projection.js";

// P4A Constraint Runtime + PR4 Typed Validators
export {
  evaluateConstraints,
  buildConstraintManifest,
  parseRuntimeSpec,
  resolveRuntimeSpec,
  registerConstraintRuleEvaluator,
  getConstraintRuleEvaluator,
  clearConstraintRuleEvaluatorRegistry,
  isConstraintRuleKnown,
} from "./constraint-runtime.js";

export type {
  RuntimeAction,
  ConstraintViolation,
  ConstraintDecision,
  ConstraintManifest,
  ConstraintInput,
  ConstraintRuleType,
  ConstraintRuntimeSpec,
  ConstraintRuleEvaluator,
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

// Generic Resource Protocol
export {
  ResourceClaimStatus,
  ResourceClaimMode,
  ResourceRefSchema,
  ResourceClaimSchema,
  ResourceClaimCreateSchema,
  resourceLocatorsOverlap,
  detectResourceClaimConflicts,
  registerResourceMatcher,
  getResourceMatcher,
  clearResourceMatcherRegistry,
} from "./resource.js";

export type {
  ResourceRef,
  ResourceClaim,
  ResourceClaimCreate,
  ResourceConflict,
  ResourceMatcher,
} from "./resource.js";

export {
  FileAuditDecisionKind,
  evaluateFileAuditChange,
  findMatchingClaims,
  gateMatchesResource,
  parseRelatedFileLocators,
} from "./file-audit.js";

export type {
  FileAuditGateContext,
  FileAuditInput,
  FileAuditDecision,
} from "./file-audit.js";

// Generic Operation Protocol
export {
  OperationStatus,
  validateOperationTransition,
  OperationSchema,
  OperationCreateSchema,
} from "./operation.js";

export type {
  Operation,
  OperationCreate,
  OperationCheckItem,
  OperationCheckResult,
  OperationApproval,
} from "./operation.js";

export {
  WriteIntent,
  WritePermitStatus,
  WriteDecisionReason,
  WriteResourceHashSchema,
  WriteDecisionBlockerSchema,
  WriteDecisionWarningSchema,
  WriteDecisionSchema,
  WritePermitSchema,
  WritePermitCreateSchema,
  evaluateWriteDecision,
} from "./write-permit.js";

export type {
  WriteResourceHash,
  WriteDecisionBlocker,
  WriteDecisionWarning,
  WriteDecision,
  WritePermit,
  WritePermitCreate,
  WriteConstraintDecisionInput,
  WriteDecisionInput,
} from "./write-permit.js";

// Generic StateSnapshot
export {
  StateSnapshotSchema,
  StateSnapshotCreateSchema,
} from "./state-snapshot.js";

export type {
  StateSnapshot,
  StateSnapshotCreate,
} from "./state-snapshot.js";

// Generic Validator Protocol
export {
  registerOperationValidator,
  getValidatorsForOperation,
  runOperationValidation,
  clearValidatorRegistry,
} from "./validator.js";

export type {
  OperationValidator,
  OperationValidationContext,
} from "./validator.js";

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
  // Liveness
  GatePolicyKind,
  GateTimeoutAction,
  GatePolicySchema,
  DEFAULT_GATE_POLICY,
  GateVoteKind,
  GateVoteSchema,
  GateVoteCreateSchema,
  LivenessAction,
  quorumMet,
  parseGatePolicy,
  countVotes,
  evaluateGateLiveness,
  isGateBlocking,
  hasPartialAcks,
  computeAvailableActions,
  computeGateDetails,
} from "./sync-gate.js";

export type {
  SyncGate,
  SyncGateCreate,
  SyncGateAck,
  GatePolicy,
  GateVote,
  GateVoteCreate,
  LivenessDecision,
  GateAction,
  GateDetailedStatus,
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

// Negotiation Protocol
export {
  NegotiationStatus,
  NEGOTIATION_TRANSITIONS,
  validateNegotiationTransition,
  NegotiationMessageKind,
  DEFAULT_NEGOTIATION_CONFIG,
  NegotiationConfigSchema,
  NegotiationSessionSchema,
  NegotiationMessageSchema,
  parseNegotiationConfig,
  isNegotiationExpired,
  isRoundExpired,
  detectDeadlock,
  evaluateNegotiation,
} from "./negotiation.js";

export type {
  NegotiationConfig,
  NegotiationSession,
  NegotiationMessage,
} from "./negotiation.js";

// Agent Manifest + Escalation Routing
export {
  AgentCapabilitySchema,
  EscalationOptIn,
  EscalationPreferenceSchema,
  AgentAvailability,
  AgentManifestSchema,
  DEFAULT_AGENT_MANIFEST,
  routeEscalation,
} from "./agent-manifest.js";

export type {
  AgentCapability,
  EscalationPreference,
  AgentManifest,
  EscalationCandidate,
  EscalationRoutingInput,
} from "./agent-manifest.js";
