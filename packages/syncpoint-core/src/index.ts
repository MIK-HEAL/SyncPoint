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
} from "./project-memory.js";

export type {
  ProjectMemory,
  ProjectMemoryCreate,
} from "./project-memory.js";

// Prompt Template Engine
export { formatResumePrompt } from "./prompt-templates.js";
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
  getContextPolicy,
  listContextIntents,
  listContextRoles,
} from "./context-policy.js";

export type {
  ContextPolicy,
  ContextPolicyCheck,
  PreparedContext,
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
