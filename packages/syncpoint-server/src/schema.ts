/**
 * Drizzle ORM schema for SyncPoint SQLite.
 */

import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  changedFiles: text("changed_files").notNull().default(""), // @deprecated — use workingResources on capsule. Rename to changedResources in future migration.
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

// ── ContextCapsule ─────────────────────────────────────

export const contextCapsules = sqliteTable("context_capsule", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  checkpointId: text("checkpoint_id").notNull().references(() => checkpoints.id),
  goal: text("goal").notNull().default(""),
  currentPhase: text("current_phase").notNull().default(""),
  confirmedDecisions: text("confirmed_decisions").notNull().default(""),
  interfaceContract: text("interface_contract").notNull().default(""),
  workingResources: text("working_files").notNull().default(""),
  completedWork: text("completed_work").notNull().default(""),
  remainingWork: text("remaining_work").notNull().default(""),
  risks: text("risks").notNull().default(""),
  blockers: text("blockers").notNull().default(""),
  nextSteps: text("next_steps").notNull().default(""),
  resumePrompt: text("resume_prompt").notNull().default(""),
  // P12 extended capsule fields
  intentScope: text("intent_scope").notNull().default(""),
  nonGoals: text("non_goals").notNull().default(""),
  verifiedFacts: text("verified_facts").notNull().default(""),
  unverifiedClaims: text("unverified_claims").notNull().default(""),
  evidenceRefs: text("evidence_refs").notNull().default(""),
  activeConstraints: text("active_constraints").notNull().default(""),
  doNotTouch: text("do_not_touch").notNull().default(""),
  handoffInstructions: text("handoff_instructions").notNull().default(""),
  validationStatus: text("validation_status").notNull().default(""),
  staleReason: text("stale_reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
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
  tags: text("tags").notNull().default(""),
  sourceType: text("source_type").notNull().default("human"),
  sourceRef: text("source_ref").notNull().default(""),
  status: text("status").notNull().default("draft"),
  confidence: text("confidence").notNull().default("medium"),
  taskId: text("task_id"),
  fingerprint: text("fingerprint").notNull().default(""),
  supersedes: text("supersedes"),
  supersededBy: text("superseded_by"),
  // V2 fields
  kind: text("kind").notNull().default("fact"),
  projectionTarget: text("projection_target"),
  appliesTo: text("applies_to").notNull().default(""),
  severity: text("severity").notNull().default("info"),
  validityStatus: text("validity_status").notNull().default("fresh"),
  validityStaleReason: text("validity_stale_reason").notNull().default(""),
  // PR4 typed constraint validator
  validatorType: text("validator_type").notNull().default(""),
  validatorConfig: text("validator_config").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
  resourcesJson: text("resources_json").notNull(),
  mode: text("mode").notNull().default("exclusive"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: text("created_at").notNull(),
  releasedAt: text("released_at").notNull().default(""),
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

// ── SyncGate ──────────────────────────────────────────

export const syncGates = sqliteTable("sync_gate", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().default(""),
  taskId: text("task_id").notNull(),
  requestedByAgentId: text("requested_by_agent_id").notNull(),
  requiredAgentIds: text("required_agent_ids").notNull(),
  ackedAgentIds: text("acked_agent_ids").notNull().default(""),
  reason: text("reason").notNull().default("manual_request"),
  description: text("description").notNull().default(""),
  relatedFiles: text("related_files").notNull().default(""),
  relatedResourcesJson: text("related_resources_json").notNull().default(""),
  relatedCheckpointId: text("related_checkpoint_id").notNull().default(""),
  relatedClaimIds: text("related_claim_ids").notNull().default(""),
  status: text("status").notNull().default("NEEDS_SYNC"),
  decisionSummary: text("decision_summary").notNull().default(""),
  policyJson: text("policy_json").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── SyncGate Vote ────────────────────────────────────

export const syncGateVotes = sqliteTable("sync_gate_vote", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull(),
  agentId: text("agent_id").notNull(),
  vote: text("vote").notNull(),
  summary: text("summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  gateAgentUnique: uniqueIndex("uq_gate_vote_agent").on(table.gateId, table.agentId),
}));

// ── SyncTransaction ──────────────────────────────────

export const syncTransactions = sqliteTable("sync_transaction", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id").notNull(),
  checkpointId: text("checkpoint_id").notNull(),
  requestingAgentId: text("requesting_agent_id").notNull(),
  requiredApproverIds: text("required_approver_ids").notNull(),
  approvedByIds: text("approved_by_ids").notNull().default(""),
  rejectedByIds: text("rejected_by_ids").notNull().default(""),
  gateId: text("gate_id").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  decisionSummary: text("decision_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ── Operation (generic) ──────────────────────────────

export const operations = sqliteTable("operation", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  actorId: text("actor_id").notNull(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id").notNull().default(""),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  targetResourcesJson: text("target_resources_json").notNull().default("[]"),
  payloadRef: text("payload_ref").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  checkResult: text("check_result").notNull().default(""),
  decisionSummary: text("decision_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const writePermits = sqliteTable("write_permit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  taskId: text("task_id").notNull(),
  sessionId: text("session_id").notNull().default(""),
  resourcesJson: text("resources_json").notNull().default("[]"),
  intent: text("intent").notNull(),
  operationId: text("operation_id").notNull().default(""),
  guardedRoot: text("guarded_root").notNull().default(""),
  baseHashesJson: text("base_hashes_json").notNull().default("[]"),
  expiresAt: text("expires_at").notNull(),
  singleUse: integer("single_use", { mode: "boolean" }).notNull().default(true),
  status: text("status").notNull(),
  decisionJson: text("decision_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  consumedAt: text("consumed_at").notNull().default(""),
});

// ── PatchProposal ────────────────────────────────────

export const patchProposals = sqliteTable("patch_proposal", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  taskId: text("task_id").notNull(),
  agentId: text("agent_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  patchText: text("patch_text").notNull(),
  touchedFiles: text("touched_files").notNull().default(""),
  relatedClaimIds: text("related_claim_ids").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  checkResult: text("check_result").notNull().default(""),
  decisionSummary: text("decision_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
  participantIds: text("participant_ids").notNull(),
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
