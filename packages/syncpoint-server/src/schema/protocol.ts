import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { GatePolicyKind, GateTimeoutAction } from "syncpoint-core";
import { agents, tasks } from "./foundation.js";

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
}, (table) => ({
  actorStatusIdx: index("idx_claims_actor_status").on(table.actorId, table.status),
  sessionIdx: index("idx_claims_session").on(table.sessionId),
  taskIdx: index("idx_claims_task").on(table.taskId),
}));

/** Join table: individual resources for a claim (replaces resourcesJson) */
export const resourceClaimResources = sqliteTable("resource_claim_resource", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull().references(() => resourceClaims.id),
  resourceType: text("resource_type").notNull(),
  locator: text("locator").notNull(),
  scope: text("scope").notNull().default("file"),
  functionName: text("function_name"),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  metadata: text("metadata").notNull().default(""),
}, (table) => ({
  claimIdIdx: index("idx_rcr_claim").on(table.claimId),
}));

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
  policyJson: text("policy_json", { mode: "json" }).$type<import("syncpoint-core").GatePolicy>().notNull().default({ kind: GatePolicyKind.ALL_REQUIRED, timeoutAction: GateTimeoutAction.ESCALATE }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  statusCreatedIdx: index("idx_gates_status_created").on(table.status, table.createdAt),
  taskIdx: index("idx_gates_task").on(table.taskId),
}));

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
  scope: text("scope").notNull().default("file"),
  functionName: text("function_name"),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  metadata: text("metadata").notNull().default(""),
}, (table) => ({
  gateIdIdx: index("idx_sgr_gate").on(table.gateId),
}));

/** Join table: related claim IDs for a gate */
export const syncGateRelatedClaims = sqliteTable("sync_gate_related_claim", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull().references(() => syncGates.id),
  claimId: text("claim_id").notNull(),
}, (table) => ({
  gateIdIdx: index("idx_sgrc_gate").on(table.gateId),
}));

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

// ── CheckpointReview ─────────────────────────────────

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
}, (table) => ({
  taskCreatedIdx: index("idx_reviews_task_created").on(table.taskId, table.createdAt),
  statusIdx: index("idx_reviews_status").on(table.status),
  requestingAgentIdx: index("idx_reviews_req_agent").on(table.requestingAgentId),
}));

/** Join table: approvers for a checkpoint review (replaces CSV fields) */
export const checkpointReviewApprovers = sqliteTable("checkpoint_review_approver", {
  id: text("id").primaryKey(),
  reviewId: text("review_id").notNull().references(() => checkpointReviews.id),
  agentId: text("agent_id").notNull(),
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
  checkResultJson: text("check_result", { mode: "json" }).$type<import("syncpoint-core").OperationCheckResult | null>().default(null),
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
  scope: text("scope").notNull().default("file"),
  functionName: text("function_name"),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  metadata: text("metadata").notNull().default(""),
}, (table) => ({
  operationIdIdx: index("idx_opr_op").on(table.operationId),
}));

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
  decisionJson: text("decision_json", { mode: "json" }).$type<import("syncpoint-core").WriteDecision>().notNull(),
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
  scope: text("scope").notNull().default("file"),
  functionName: text("function_name"),
  lineStart: integer("line_start"),
  lineEnd: integer("line_end"),
  metadata: text("metadata").notNull().default(""),
}, (table) => ({
  permitIdIdx: index("idx_wpr_permit").on(table.permitId),
}));
