/**
 * Drizzle ORM schema for SyncPoint SQLite.
 */

import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ── Runtime ────────────────────────────────────────────

export const runtimes = sqliteTable("runtime", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("local-mcp"),
  provider: text("provider").notNull().default(""),
  host: text("host").notNull().default(""),
  workspaceRoot: text("workspace_root").notNull().default(""),
  agentId: text("agent_id"),
  status: text("status").notNull().default("ACTIVE"),
  lastSeenAt: text("last_seen_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ── Agent ──────────────────────────────────────────────

export const agents = sqliteTable("agent", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("IDLE"),
  currentTaskId: text("current_task_id"),
  runtimeId: text("runtime_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Task ───────────────────────────────────────────────

export const tasks = sqliteTable("task", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  ownerAgentId: text("owner_agent_id"),
  parentTaskId: text("parent_task_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Checkpoint ─────────────────────────────────────────

export const checkpoints = sqliteTable("checkpoint", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  summary: text("summary").notNull(),
  progress: text("progress").notNull().default(""),
  currentUnderstanding: text("current_understanding").notNull().default(""),
  changedFiles: text("changed_files").notNull().default(""), // @deprecated — use workingResources on context snapshot. Rename to changedResources in future migration.
  risks: text("risks").notNull().default(""),
  blockers: text("blockers").notNull().default(""),
  nextSteps: text("next_steps").notNull().default(""),
  needSync: integer("need_sync", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

// ── DiaryEntry ─────────────────────────────────────────

export const diaryEntries = sqliteTable("diary_entry", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  entryType: text("entry_type").notNull().default("NOTE"),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

// ── Handoff ────────────────────────────────────────────

export const handoffs = sqliteTable("handoff", {
  id: text("id").primaryKey(),
  fromAgentId: text("from_agent_id").notNull().references(() => agents.id),
  toAgentId: text("to_agent_id").notNull().references(() => agents.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  contextSummary: text("context_summary").notNull(),
  status: text("status").notNull().default("PENDING"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── PeerContract ───────────────────────────────────────

export const peerContracts = sqliteTable("peer_contract", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  title: text("title").notNull().default(""),
  participants: text("participants").notNull().default(""),
  scope: text("scope").notNull().default(""),
  responsibilities: text("responsibilities").notNull().default(""),
  interfaceSpec: text("interface_spec").notNull().default(""),
  fileBoundaries: text("file_boundaries").notNull().default(""), // @deprecated — rename to resourceBoundaries in future migration.
  dependencies: text("dependencies").notNull().default(""),
  testPlan: text("test_plan").notNull().default(""),
  risks: text("risks").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── ContextSnapshot (replaces context_capsule wide table) ──

export const contextSnapshots = sqliteTable("context_snapshot", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  checkpointId: text("checkpoint_id").notNull().references(() => checkpoints.id),
  kind: text("kind").notNull().default("checkpoint"),
  summary: text("summary").notNull().default(""),
  /** Typed JSON payload — structure depends on `kind` */
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const contextSnapshotResources = sqliteTable("context_snapshot_resource", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull().references(() => contextSnapshots.id),
  resourceType: text("resource_type").notNull(),
  locator: text("locator").notNull(),
  metadata: text("metadata").notNull().default(""),
});

// ── Event ──────────────────────────────────────────────

export const events = sqliteTable("event", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ── ProjectMemory ─────────────────────────────────────

export const projectMemories = sqliteTable("project_memory", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull().default("project"),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceType: text("source_type").notNull().default("human"),
  sourceRef: text("source_ref").notNull().default(""),
  status: text("status").notNull().default("draft"),
  confidence: text("confidence").notNull().default("medium"),
  taskId: text("task_id"),
  kind: text("kind").notNull().default("fact"),
  createdBy: text("created_by").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  statusIndex: index("idx_project_memory_status").on(table.status),
  categoryIndex: index("idx_project_memory_category").on(table.category),
  scopeIndex: index("idx_project_memory_scope").on(table.scope),
  taskIndex: index("idx_project_memory_task").on(table.taskId),
}));

export const projectMemoryTags = sqliteTable("project_memory_tag", {
  id: text("id").primaryKey(),
  memoryId: text("memory_id").notNull().references(() => projectMemories.id),
  tag: text("tag").notNull(),
}, (table) => ({
  memoryTagUnique: uniqueIndex("uq_project_memory_tag").on(table.memoryId, table.tag),
}));

export const projectMemoryVersions = sqliteTable("project_memory_version", {
  memoryId: text("memory_id").primaryKey().references(() => projectMemories.id),
  fingerprint: text("fingerprint").notNull().default(""),
  supersedesMemoryId: text("supersedes_memory_id"),
  supersededByMemoryId: text("superseded_by_memory_id"),
}, (table) => ({
  fingerprintIndex: index("idx_project_memory_version_fingerprint").on(table.fingerprint),
}));

export const projectMemoryProjections = sqliteTable("project_memory_projection", {
  memoryId: text("memory_id").primaryKey().references(() => projectMemories.id),
  projectionTarget: text("projection_target"),
});

export const projectMemoryScopes = sqliteTable("project_memory_scope", {
  id: text("id").primaryKey(),
  memoryId: text("memory_id").notNull().references(() => projectMemories.id),
  field: text("field").notNull(),
  pattern: text("pattern").notNull(),
}, (table) => ({
  memoryScopeUnique: uniqueIndex("uq_project_memory_scope").on(table.memoryId, table.field, table.pattern),
  fieldIndex: index("idx_project_memory_scope_field").on(table.field),
}));

export const projectMemoryValidations = sqliteTable("project_memory_validation", {
  memoryId: text("memory_id").primaryKey().references(() => projectMemories.id),
  severity: text("severity").notNull().default("info"),
  validityStatus: text("validity_status").notNull().default("fresh"),
  staleReason: text("stale_reason").notNull().default(""),
  validatorType: text("validator_type").notNull().default(""),
  validatorMessage: text("validator_message").notNull().default(""),
  validatorPayload: text("validator_payload").notNull().default(""),
}, (table) => ({
  validatorTypeIndex: index("idx_project_memory_validation_type").on(table.validatorType),
}));

export const projectMemoryValidationActions = sqliteTable("project_memory_validation_action", {
  id: text("id").primaryKey(),
  memoryId: text("memory_id").notNull().references(() => projectMemories.id),
  action: text("action").notNull(),
}, (table) => ({
  memoryActionUnique: uniqueIndex("uq_project_memory_validation_action").on(table.memoryId, table.action),
}));

// ── OrchestrationSession ──────────────────────────────

export const orchestrationSessions = sqliteTable("orchestration_session", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("PLANNING"),
  relationshipMode: text("relationship_mode").notNull().default("manager-delegate"),
  architectId: text("architect_id"),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── RoleProfile ───────────────────────────────────────

export const roleProfiles = sqliteTable("role_profile", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => orchestrationSessions.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  role: text("role").notNull(),
  capabilities: text("capabilities").notNull().default(""),
  assignedAt: text("assigned_at").notNull(),
});

// ── TaskAssignment ────────────────────────────────────

export const taskAssignments = sqliteTable("task_assignment", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => orchestrationSessions.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  assigneeAgentId: text("assignee_agent_id").notNull().references(() => agents.id),
  assignedBy: text("assigned_by").notNull().default(""),
  status: text("status").notNull().default("PROPOSED"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── ReviewRequest ─────────────────────────────────────

export const reviewRequests = sqliteTable("review_request", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => orchestrationSessions.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  reviewerAgentId: text("reviewer_agent_id").notNull().references(() => agents.id),
  requestedBy: text("requested_by").notNull().default(""),
  scope: text("scope").notNull().default(""),
  status: text("status").notNull().default("PENDING"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── ReviewDecision ────────────────────────────────────

export const reviewDecisions = sqliteTable("review_decision", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id),
  verdict: text("verdict").notNull(),
  summary: text("summary").notNull(),
  requestedChanges: text("requested_changes").notNull().default(""),
  decidedBy: text("decided_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ── ReviewChecklistItem ──────────────────────────────

export const reviewChecklistItems = sqliteTable("review_checklist_item", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull().default("OPEN"),
  notes: text("notes").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── ReviewEvidence ───────────────────────────────────

export const reviewEvidences = sqliteTable("review_evidence", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  metadataJson: text("metadata_json").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ── ChangeRequest ────────────────────────────────────

export const changeRequests = sqliteTable("change_request", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id),
  summary: text("summary").notNull(),
  items: text("items").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  evidenceId: text("evidence_id"),
  requestedBy: text("requested_by").notNull().default(""),
  addressedBy: text("addressed_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── ApprovalRecord ───────────────────────────────────

export const approvalRecords = sqliteTable("approval_record", {
  id: text("id").primaryKey(),
  reviewRequestId: text("review_request_id").notNull().references(() => reviewRequests.id),
  decision: text("decision").notNull(),
  summary: text("summary").notNull(),
  requestedChanges: text("requested_changes").notNull().default(""),
  waiverReason: text("waiver_reason").notNull().default(""),
  decidedBy: text("decided_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// ── WakeRequest ──────────────────────────────────────

export const wakeRequests = sqliteTable("wake_request", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => orchestrationSessions.id),
  targetAgentId: text("target_agent_id").notNull().references(() => agents.id),
  targetRole: text("target_role").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  triggerEventType: text("trigger_event_type").notNull(),
  triggerEntityId: text("trigger_entity_id").notNull(),
  taskId: text("task_id"),
  reviewRequestId: text("review_request_id"),
  promptHint: text("prompt_hint").notNull().default(""),
  mcpToolHint: text("mcp_tool_hint").notNull().default(""),
  cliHint: text("cli_hint").notNull().default(""),
  runnerMode: text("runner_mode").notNull().default("manual"),
  status: text("status").notNull().default("QUEUED"),
  resultSummary: text("result_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── ResourceClaim (generic) ───────────────────────────

export const resourceClaims = sqliteTable("resource_claim", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id").notNull().default(""),
  resourceType: text("resource_type").notNull(),
  mode: text("mode").notNull().default("exclusive"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull(),
  releasedAt: text("released_at").notNull().default(""),
});

/** Join table: individual resources for a claim (replaces resourcesJson) */
export const resourceClaimResources = sqliteTable("resource_claim_resource", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull().references(() => resourceClaims.id),
  resourceType: text("resource_type").notNull(),
  locator: text("locator").notNull(),
  metadata: text("metadata").notNull().default(""),
});

// ── FileClaim ─────────────────────────────────────────

export const fileClaims = sqliteTable("file_claim", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  taskId: text("task_id").notNull().references(() => tasks.id),
  sessionId: text("session_id").notNull().default(""),
  paths: text("paths").notNull(),
  mode: text("mode").notNull().default("exclusive"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull(),
  releasedAt: text("released_at").notNull().default(""),
});

// ── SyncGate (normalized — CSV fields removed) ────────

export const syncGates = sqliteTable("sync_gate", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().default(""),
  taskId: text("task_id").notNull(),
  requestedByAgentId: text("requested_by_agent_id").notNull(),
  reason: text("reason").notNull().default("manual_request"),
  description: text("description").notNull().default(""),
  relatedCheckpointId: text("related_checkpoint_id").notNull().default(""),
  status: text("status").notNull().default("NEEDS_SYNC"),
  decisionSummary: text("decision_summary").notNull().default(""),
  policyJson: text("policy_json").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Join table: which agents are required to ack this gate */
export const syncGateRequiredAgents = sqliteTable("sync_gate_required_agent", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => syncGates.id),
  agentId: text("agent_id").notNull(),
}, (table) => ({
  gateAgentUnique: uniqueIndex("uq_gate_req_agent").on(table.gateId, table.agentId),
}));

/** Join table: related resources for a gate */
export const syncGateResources = sqliteTable("sync_gate_resource", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => syncGates.id),
  resourceType: text("resource_type").notNull(),
  locator: text("locator").notNull(),
  metadata: text("metadata").notNull().default(""),
});

/** Join table: related claim IDs for a gate */
export const syncGateRelatedClaims = sqliteTable("sync_gate_related_claim", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => syncGates.id),
  claimId: text("claim_id").notNull(),
});

// ── SyncGate Ack (replaces ackedAgentIds CSV) ──
// One row per (gate, agent) — represents "I see it / I'm aware".
// Separate from governance votes: an agent can both ack AND vote.

export const syncGateAcks = sqliteTable("sync_gate_ack", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => syncGates.id),
  agentId: text("agent_id").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  gateAgentUnique: uniqueIndex("uq_gate_ack_agent").on(table.gateId, table.agentId),
}));

// ── SyncGate Vote (governance only: approve/reject/abstain/escalate) ──
// One row per (gate, agent) — last vote wins (overwrite).
// ACK is NOT a valid vote kind — use sync_gate_ack instead.

export const syncGateVotes = sqliteTable("sync_gate_vote", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => syncGates.id),
  agentId: text("agent_id").notNull(),
  vote: text("vote").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  gateAgentUnique: uniqueIndex("uq_gate_vote_agent").on(table.gateId, table.agentId),
}));

// ── CheckpointReview (replaces sync_transaction) ─────

export const checkpointReviews = sqliteTable("checkpoint_review", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id").notNull(),
  checkpointId: text("checkpoint_id").notNull(),
  requestingAgentId: text("requesting_agent_id").notNull(),
  gateId: text("gate_id").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  decisionSummary: text("decision_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Join table: approvers for a checkpoint review (replaces CSV fields) */
export const checkpointReviewApprovers = sqliteTable("checkpoint_review_approver", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => checkpointReviews.id),
  agentId: text("agent_id").notNull(),
  /** required | approved | rejected */
  role: text("role").notNull().default("required"),
  decidedAt: text("decided_at").notNull().default(""),
}, (table) => ({
  reviewAgentUnique: uniqueIndex("uq_review_approver").on(table.reviewId, table.agentId),
}));

// ── Operation (generic) ──────────────────────────────

export const operations = sqliteTable("operation", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  actorId: text("actor_id").notNull(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id").notNull().default(""),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  payloadRef: text("payload_ref").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  checkResult: text("check_result").notNull().default(""),
  decisionSummary: text("decision_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Join table: target resources for an operation (replaces targetResourcesJson) */
export const operationResources = sqliteTable("operation_resource", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull().references(() => operations.id),
  resourceType: text("resource_type").notNull(),
  locator: text("locator").notNull(),
  metadata: text("metadata").notNull().default(""),
});

export const writePermits = sqliteTable("write_permit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id").notNull().default(""),
  intent: text("intent").notNull(),
  operationId: text("operation_id").notNull().default(""),
  guardedRoot: text("guarded_root").notNull().default(""),
  expiresAt: text("expires_at").notNull(),
  singleUse: integer("single_use", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull(),
  decisionJson: text("decision_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  consumedAt: text("consumed_at").notNull().default(""),
});

/** Join table: resources + base hashes for a write permit */
export const writePermitResources = sqliteTable("write_permit_resource", {
  id: text("id").primaryKey(),
  permitId: text("permit_id").notNull().references(() => writePermits.id),
  resourceType: text("resource_type").notNull(),
  locator: text("locator").notNull(),
  baseHash: text("base_hash").notNull().default(""),
  metadata: text("metadata").notNull().default(""),
});

// ── Agent Manifest ──────────────────────────────────

export const agentManifests = sqliteTable("agent_manifest", {
  agentId: text("agent_id").primaryKey(),
  capabilitiesJson: text("capabilities_json").notNull().default("[]"),
  escalationPreferenceJson: text("escalation_preference_json").notNull().default("{}"),
  availability: text("availability").notNull().default("online"),
  canHandleHumanEscalation: integer("can_handle_human_escalation", { mode: "boolean" }).notNull().default(false),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Negotiation Session ─────────────────────────────

export const negotiationSessions = sqliteTable("negotiation_session", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull(),
  status: text("status").notNull().default("OPEN"),
  currentRound: integer("current_round").notNull().default(0),
  configJson: text("config_json").notNull().default("{}"),
  roundStartedAt: text("round_started_at"),
  deadlineAt: text("deadline_at"),
  resolvedByAgentId: text("resolved_by_agent_id"),
  resolutionSummary: text("resolution_summary"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Join table: participants in a negotiation session (replaces participantIds CSV) */
export const negotiationParticipants = sqliteTable("negotiation_participant", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => negotiationSessions.id),
  agentId: text("agent_id").notNull(),
}, (table) => ({
  sessionAgentUnique: uniqueIndex("uq_neg_participant").on(table.sessionId, table.agentId),
}));

// ── Negotiation Message ─────────────────────────────

export const negotiationMessages = sqliteTable("negotiation_message", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  agentId: text("agent_id").notNull(),
  round: integer("round").notNull().default(0),
  kind: text("kind").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

// ── PinnedMemory ──────────────────────────────────────

export const pinnedMemories = sqliteTable("pinned_memory", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  content: text("content").notNull(),
  scope: text("scope").notNull().default("project"),
  taskId: text("task_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── FTS5 (full-text search for project memory) ──────
// Drizzle ORM does not manage FTS5 virtual tables.
// This SQL must be executed manually in db.ts during table creation.

export const PROJECT_MEMORY_FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_fts
  USING fts5(
    memory_id UNINDEXED,
    title,
    content,
    category,
    tags,
    tokenize='porter unicode61'
  );
`;
