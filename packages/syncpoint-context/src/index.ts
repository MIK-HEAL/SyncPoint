/**
 * SyncPoint context layer — memory, projection, policy, and state snapshot surfaces.
 *
 * Phase 4b: source files are now physically hosted here.
 * syncpoint-core retains copies for backward compatibility.
 */

// ── Memory / pinned context ───────────────────────────
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

// ── Project memory ───────────────────────────────────
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

// ── Reality projection ───────────────────────────────
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

// ── Context policy / modes ──────────────────────────
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

// ── Generic state snapshots ──────────────────────────
export {
  StateSnapshotSchema,
  StateSnapshotCreateSchema,
} from "./state-snapshot.js";
export type {
  StateSnapshot,
  StateSnapshotCreate,
} from "./state-snapshot.js";

// ── Prompt templates (contextual formatting helpers) ──
export {
  formatResumePrompt,
  formatRealityProjection,
} from "./prompt-templates.js";
export type { PromptFormat } from "./prompt-templates.js";

// ── Snapshot payload types (context-native) ────────────
export type { ContextSnapshotPayload } from "./memory.js";
