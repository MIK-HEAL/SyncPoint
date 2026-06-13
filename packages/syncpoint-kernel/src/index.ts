/**
 * SyncPoint kernel — minimal coordination primitives.
 *
 * Phase 3: source files are now physically hosted here.
 * syncpoint-core retains copies for backward compatibility.
 */

// ── Resource claim + matching ──────────────────────────
export {
  ResourceScope,
  LineRangeSchema,
  ResourceRefSchema,
  ResourceClaimStatus,
  ResourceClaimMode,
  ResourceClaimSchema,
  ResourceClaimCreateSchema,
  resourceLocatorsOverlap,
  detectResourceClaimConflicts,
  registerResourceMatcher,
  getResourceMatcher,
  clearResourceMatcherRegistry,
} from "./resource.js";
export type {
  LineRange,
  ResourceRef,
  ResourceClaim,
  ResourceClaimCreate,
  ResourceConflict,
  ResourceMatcher,
} from "./resource.js";

// ── Path normalization ────────────────────────────────
export {
  normalizeResourcePath,
  arePathsEquivalent,
  toResourceLocatorKey,
} from "./path-normalize.js";
export type { NormalizePathOptions } from "./path-normalize.js";

// ── File audit (editor guard) ──────────────────────────
export {
  FileAuditDecisionKind,
  evaluateFileAuditChange,
  gateMatchesResource,
} from "./file-audit.js";
export type {
  FileAuditDecision,
  FileAuditGateContext,
} from "./file-audit.js";

// ── Sync gate ─────────────────────────────────────────
export {
  SyncGateStatus,
  SyncGateReason,
  SYNC_GATE_TRANSITIONS,
  validateSyncGateTransition,
  SyncGateSchema,
  SyncGateCreateSchema,
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
  parseGatePolicy,
  countVotes,
  evaluateGateLiveness,
  isGateBlocking,
  hasPartialAcks,
  parseIdList,
  allAcked,
  pendingAgents,
  isAgentBlocked,
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

// ── Operation + validators ────────────────────────────
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
  registerOperationValidator,
  getValidatorsForOperation,
  runOperationValidation,
  clearValidatorRegistry,
} from "./validator.js";
export type {
  OperationValidator,
  OperationValidationContext,
} from "./validator.js";

// ── Write permits ─────────────────────────────────────
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

// ── Line-range drift ──────────────────────────────────
export {
  computeLineDrift,
  remapLineRanges,
  rangeStillExists,
} from "./line-range-drift.js";
export type {
  DriftResult,
  LineMapping,
} from "./line-range-drift.js";

// ── Function parser ───────────────────────────────────
export {
  parseFunctions,
  findFunctionAtLine,
  registerFunctionParseStrategy,
  getFunctionParseStrategy,
  getStrategyForExtension,
  clearFunctionParseStrategies,
} from "./function-parser.js";
export type {
  ParsedFunction,
  FunctionParseStrategy,
} from "./function-parser.js";

// ── Errors ────────────────────────────────────────────
export {
  SyncPointError,
  ResourceConflictError,
  ResourceNotFoundError,
  ConstraintViolationError,
  UnauthorizedError,
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
  DatabaseError,
  OperationTimeoutError,
  InternalError,
} from "./errors.js";

// ── Events (hosted locally in kernel) ──
export { EventType, EventSchema } from "./events.js";
export type { Event } from "./events.js";

// ── Approval gate (shared kernel types) ──────────────────
export {
  ApprovalGateStatus,
  ApprovalGateResultSchema,
} from "./approval-gate.js";
export type { ApprovalGateResult } from "./approval-gate.js";

// ── Playbook action kind (shared kernel enum) ──────────
export { PlaybookActionKind } from "./playbook-action-kind.js";

// ── Relationship mode (shared kernel types) ──────────────
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
export type { ModeSyncRule, ModeActionVerdict } from "./relationship-mode.js";
