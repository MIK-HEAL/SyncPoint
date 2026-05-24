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
  ContextSnapshotSchema,
  ContextSnapshotCreateSchema,
  ContextSnapshotPayloadSchema,
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
  ContextSnapshot,
  ContextSnapshotCreate,
  ContextSnapshotPayload,
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
  ProjectMemoryValidatorConfigSchema,
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
  ProjectMemoryValidatorConfig,
} from "./project-memory.js";

// Reality Projection
export {
  buildRealityProjection,
  computeProjectionCacheKey,
  computeProjectionLookupKey,
  computeContentHash,
  resolveProjectionRoute,
  registerScopeMatcher,
  getScopeMatcher,
  clearScopeMatcherRegistry,
} from "./reality-projection.js";

export type {
  RealityProjection,
  ProjectedMemoryItem,
  ProjectionScope,
  RealityProjectionConflict,
  ProjectionSource,
  ContextPatch,
  ProjectionCreatedFrom,
  ProjectionValidityStatus,
  MemoryProjectionInput,
  ProjectionContext,
  ProjectionRoute,
  ScopeMatcher,
} from "./reality-projection.js";

// Constraint Evaluation
export {
  evaluateConstraints,
  buildConstraintManifest,
  parseRuntimeSpec,
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

// Prompt Template Engine
export { formatResumePrompt, formatRealityProjection } from "./prompt-templates.js";
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
  GateAckSchema,
  GateAckCreateSchema,
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
  GateAck,
  GateAckCreate,
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

// CheckpointReview
export {
  CheckpointReviewStatus,
  CHECKPOINT_REVIEW_TRANSITIONS,
  validateCheckpointReviewTransition,
  CheckpointReviewSchema,
  CheckpointReviewCreateSchema,
  parseIdListCsv,
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

// Snapshot Dominant Context
export {
  ContextMode,
  DEFAULT_CONTEXT_MODE,
  ProtocolRuleSchema,
  ProtocolGateSummarySchema,
  SnapshotValidationSchema,
  SnapshotExtendedFieldsSchema,
} from "./context-modes.js";

export type {
  ProtocolRule,
  ProtocolGateSummary,
  SnapshotValidation,
  SnapshotExtendedFields,
} from "./context-modes.js";

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
