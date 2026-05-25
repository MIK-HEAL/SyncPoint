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

export const agentRegistryEntries = sqliteTable("agent_registry_entry", {
  manifestPath: text("manifest_path").primaryKey(),
  agentId: text("agent_id"),
  sourceFormat: text("source_format").notNull().default(""),
  contentHash: text("content_hash").notNull().default(""),
  manifestJson: text("manifest_json").notNull().default(""),
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
