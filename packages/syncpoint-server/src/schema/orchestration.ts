import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { agents, tasks } from "./foundation.js";

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
