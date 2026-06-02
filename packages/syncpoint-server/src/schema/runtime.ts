import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { DEFAULT_NEGOTIATION_CONFIG } from "syncpoint-core";

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

// ── Agent Manifest ──────────────────────────────────

export const agentManifests = sqliteTable("agent_manifest", {
  agentId: text("agent_id").primaryKey(),
  capabilitiesJson: text("capabilities_json").notNull().default("[]"),
  escalationPreferenceJson: text("escalation_preference_json").notNull().default(""),
  availability: text("availability").notNull().default("online"),
  canHandleHumanEscalation: integer("can_handle_human_escalation", { mode: "boolean" }).notNull().default(false),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentRegistryEntries = sqliteTable("agent_registry_entry", {
  manifestPath: text("manifest_path").primaryKey(),
  agentId: text("agent_id"),
  sourceFormat: text("source_format").notNull().default(""),
  contentHash: text("content_hash").notNull().default(""),
  manifestJson: text("manifest_json", { mode: "json" }).$type<import("syncpoint-core").UserAgentManifest | null>().default(null),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message").notNull().default(""),
  lastSyncAt: text("last_sync_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  agentUnique: uniqueIndex("uq_agent_registry_entry_agent").on(table.agentId),
}));

// ── Negotiation Session ─────────────────────────────

export const negotiationSessions = sqliteTable("negotiation_session", {
  id: text("id").primaryKey(),
  gateId: text("gate_id").notNull(),
  status: text("status").notNull().default("OPEN"),
  currentRound: integer("current_round").notNull().default(0),
  configJson: text("config_json", { mode: "json" }).$type<import("syncpoint-core").NegotiationConfig>().notNull().default({ maxRounds: DEFAULT_NEGOTIATION_CONFIG.maxRounds, roundDeadlineMinutes: DEFAULT_NEGOTIATION_CONFIG.roundDeadlineMinutes, negotiationDeadlineMinutes: DEFAULT_NEGOTIATION_CONFIG.negotiationDeadlineMinutes }),
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

// ── Agent Message ─────────────────────────────────

export const agentMessages = sqliteTable("agent_message", {
  id: text("id").primaryKey(),
  fromAgent: text("from_agent").notNull(),
  toAgent: text("to_agent").notNull(),
  kind: text("kind").notNull().default("message"),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  threadRootId: text("thread_root_id"),
  replyToMessageId: text("reply_to_message_id"),
  readStatus: text("read_status").notNull().default("unread"),
  readAt: text("read_at"),
  requestStatus: text("request_status").notNull().default("none"),
  respondedAt: text("responded_at"),
  expiresAt: text("expires_at"),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: text("last_retry_at"),
  escalatedAt: text("escalated_at"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  toAgentCreatedIdx: index("idx_am_to_agent_created").on(table.toAgent, table.createdAt),
  requestStatusExpiresIdx: index("idx_am_request_expires").on(table.requestStatus, table.expiresAt),
  replyToIdx: index("idx_am_reply_to").on(table.replyToMessageId),
  threadRootIdx: index("idx_am_thread_root").on(table.threadRootId),
}));

// ── State Transition Log ────────────────────────────
// Atomic audit trail for every state transition across all entities.
// Enables crash recovery, debugging, and compliance auditing.

export const stateTransitionLog = sqliteTable("state_transition_log", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),     // "resource_claim" | "sync_gate" | "checkpoint_review" | ...
  entityId: text("entity_id").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  operation: text("operation").notNull(),         // "claim" | "release" | "approve" | "reject" | ...
  agentId: text("agent_id").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  entityIdx: index("idx_stlog_entity").on(table.entityType, table.entityId),
  agentIdx: index("idx_stlog_agent").on(table.agentId),
  createdIdx: index("idx_stlog_created").on(table.createdAt),
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
