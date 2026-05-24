import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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

// ── Event ──────────────────────────────────────────────

export const events = sqliteTable("event", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
