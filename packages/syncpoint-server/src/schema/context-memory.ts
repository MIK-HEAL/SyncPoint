import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { agents, tasks } from "./foundation.js";

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
