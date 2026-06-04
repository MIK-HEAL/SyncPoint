/**
 * SyncPoint adapters/orchestration layer — external integration surfaces.
 *
 * Phase 5: source files are now physically hosted here.
 * syncpoint-core retains copies for backward compatibility.
 */

// ── Adapter protocol ──────────────────────────────────
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

// ── Orchestration ─────────────────────────────────────
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

// ── Negotiation ──────────────────────────────────────
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

// ── Agent manifest ────────────────────────────────────
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

// ── Agent file manifest ───────────────────────────────
export {
  AGENT_PROVIDER_VALUES,
  AGENT_ROLE_VALUES,
  USER_AGENT_PROVIDER_VALUES,
  UserAgentProviderSchema,
  AgentRoleSchema,
  AgentManifestFileFormatSchema,
  AgentManifestCapabilityInputSchema,
  createUserAgentManifestTemplate,
  serializeUserAgentManifest,
  UserAgentManifestSchema,
  detectUserAgentManifestFormatFromPath,
  parseUserAgentManifestContent,
  isSupportedUserAgentManifestPath,
  toAgentCreateFromUserAgentManifest,
  toRuntimeAgentManifestInputFromUserAgentManifest,
} from "./agent-file-manifest.js";
export type {
  AgentRole,
  UserAgentProvider,
  AgentManifestFileFormat,
  AgentManifestCapabilityInput,
  UserAgentManifestInput,
  UserAgentManifest,
} from "./agent-file-manifest.js";

// ── Agent team templates ──────────────────────────────
export {
  AgentTeamTemplateSchema,
  parseAgentTeamTemplateContent,
  materializeAgentTeamTemplate,
  listBuiltInAgentTeamTemplates,
  getBuiltInAgentTeamTemplate,
} from "./agent-team-template.js";
export type {
  AgentTeamTemplate,
  AgentTeamTemplateInput,
  BuiltInAgentTeamTemplate,
} from "./agent-team-template.js";

// ── Agent card ────────────────────────────────────────
export {
  AgentCardSchema,
  AgentCardEndpointSchema,
  buildAgentCard,
} from "./agent-card.js";
export type {
  AgentCard,
  AgentCardEndpoint,
  BuildAgentCardInput,
} from "./agent-card.js";

// ── Agent manifest conversion ─────────────────────────
export {
  toUserAgentManifestFromRuntime,
} from "./agent-manifest-conversion.js";
export type {
  RuntimeToUserAgentManifestInput,
} from "./agent-manifest-conversion.js";

// ── States & transitions ──────────────────────────────
export {
  AgentStatus,
  TaskStatus,
  HandoffStatus,
  ContractStatus,
  DiaryEntryType,
  AGENT_TRANSITIONS,
  TASK_TRANSITIONS,
  CONTRACT_TRANSITIONS,
  InvalidTransition,
  validateAgentTransition,
  validateTaskTransition,
  validateContractTransition,
} from "./states.js";

// ── Models (adapters core types) ──────────────────────
export { SNAPSHOT_VERSION } from "./models.js";
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
  StatusResponse,
} from "./models.js";

// Re-export context types for backward compat (previously co-located)
export type { ContextSnapshotPayload } from "syncpoint-context";

// ── Relationship mode ─────────────────────────────────
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

// ── Runtime ──────────────────────────────────────────
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

// ── Agent message ─────────────────────────────────────
export {
  AgentMessageKind,
  AgentMessageReadStatus,
  AgentMessageRequestStatus,
  AGENT_MESSAGE_REQUEST_TRANSITIONS,
  validateAgentMessageRequestTransition,
  AgentMessageSchema,
  AgentMessageCreateSchema,
  isRequestPending,
  isRequestExpired,
  isRequestEscalated,
  isRequestTimedOut,
  shouldRetry,
} from "./agent-message.js";
export type {
  AgentMessage,
  AgentMessageCreate,
} from "./agent-message.js";

// ── Playbook engine ──────────────────────────────────
export {
  PlaybookActionKind,
  NextActionSchema,
  computeNextActions,
} from "./playbook-engine.js";
export type {
  NextAction,
  SessionSnapshot,
} from "./playbook-engine.js";
