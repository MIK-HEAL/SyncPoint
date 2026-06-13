/**
 * CLI input validation tests — validates that Zod schemas correctly
 * accept valid inputs and reject invalid inputs for CLI command parameters.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Agent command arg schemas ──
const AgentCreateArgs = z.object({
  name: z.string().min(1).max(128),
  provider: z.enum(["cursor", "claude-code", "windsurf", "other"]),
  role: z.enum(["manager", "frontend", "backend", "tester", "reviewer", "architect", "other"]),
});

const AgentGetArgs = z.object({
  id: z.string().min(1).max(24),
});

// ── Task command arg schemas ──
const TaskCreateArgs = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  parentTaskId: z.string().optional(),
});

const TaskStatusArgs = z.object({
  id: z.string().min(1),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "REVIEW", "COMPLETED", "CANCELLED"]),
});

// ── Session command arg schemas ──
const SessionCreateArgs = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  relationshipMode: z.enum(["manager-delegate", "peer-collaborative", "reviewer-driven"]).optional(),
  architectId: z.string().optional(),
});

const SessionAssignRoleArgs = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  role: z.enum(["architect", "executor", "reviewer", "manager"]),
});

// ── Write command arg schemas ──
const WriteCheckArgs = z.object({
  locators: z.array(z.string().min(1)).min(1),
  actorId: z.string().min(1),
  taskId: z.string().min(1),
});

// ── Review command arg schemas ──
const ReviewApproveArgs = z.object({
  reviewRequestId: z.string().min(1),
  summary: z.string().min(1).max(1000),
  by: z.string().min(1),
});

const ReviewBlockArgs = z.object({
  reviewRequestId: z.string().min(1),
  summary: z.string().min(1).max(1000),
  requestedChanges: z.string().min(1),
  by: z.string().min(1),
});

// ── Sync command arg schemas ──
const SyncRequestArgs = z.object({
  taskId: z.string().min(1),
  requestedByAgentId: z.string().min(1),
  requiredAgentIds: z.array(z.string()).min(1),
  reason: z.string().min(1),
  description: z.string().optional(),
  policy: z.enum(["unanimous_consent", "majority_veto"]).optional(),
});

// ══════════════════════════════════════════════════════════
// Agent validation
// ══════════════════════════════════════════════════════════

describe("agent create args", () => {
  it("accepts valid agent input", () => {
    const result = AgentCreateArgs.safeParse({ name: "cursor", provider: "cursor", role: "frontend" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(AgentCreateArgs.safeParse({ name: "", provider: "cursor", role: "frontend" }).success).toBe(false);
  });

  it("rejects name over 128 chars", () => {
    expect(AgentCreateArgs.safeParse({ name: "x".repeat(129), provider: "cursor", role: "frontend" }).success).toBe(false);
  });

  it("rejects invalid provider", () => {
    expect(AgentCreateArgs.safeParse({ name: "test", provider: "invalid-vendor", role: "frontend" }).success).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(AgentCreateArgs.safeParse({ name: "test", provider: "cursor", role: "designer" }).success).toBe(false);
  });
});

describe("agent get args", () => {
  it("accepts valid ID", () => {
    expect(AgentGetArgs.safeParse({ id: "abc123def456" }).success).toBe(true);
  });

  it("rejects empty ID", () => {
    expect(AgentGetArgs.safeParse({ id: "" }).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// Task validation
// ══════════════════════════════════════════════════════════

describe("task create args", () => {
  it("accepts valid task input", () => {
    expect(TaskCreateArgs.safeParse({ title: "Build feature" }).success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(TaskCreateArgs.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects title over 256 chars", () => {
    expect(TaskCreateArgs.safeParse({ title: "x".repeat(257) }).success).toBe(false);
  });

  it("accepts optional description", () => {
    expect(TaskCreateArgs.safeParse({ title: "Test", description: "A description" }).success).toBe(true);
  });
});

describe("task status args", () => {
  it("accepts valid status transition", () => {
    expect(TaskStatusArgs.safeParse({ id: "t1", status: "IN_PROGRESS" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(TaskStatusArgs.safeParse({ id: "t1", status: "DELETED" }).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// Session validation
// ══════════════════════════════════════════════════════════

describe("session create args", () => {
  it("accepts valid session input", () => {
    expect(SessionCreateArgs.safeParse({ title: "My Session" }).success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(SessionCreateArgs.safeParse({ title: "" }).success).toBe(false);
  });

  it("accepts optional relationshipMode", () => {
    expect(SessionCreateArgs.safeParse({ title: "Test", relationshipMode: "peer-collaborative" }).success).toBe(true);
  });

  it("rejects invalid mode", () => {
    expect(SessionCreateArgs.safeParse({ title: "Test", relationshipMode: "invalid-mode" }).success).toBe(false);
  });
});

describe("session assign role args", () => {
  it("accepts valid role assignment", () => {
    expect(SessionAssignRoleArgs.safeParse({ sessionId: "s1", agentId: "a1", role: "executor" }).success).toBe(true);
  });

  it("rejects missing role", () => {
    expect(SessionAssignRoleArgs.safeParse({ sessionId: "s1", agentId: "a1" }).success).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(SessionAssignRoleArgs.safeParse({ sessionId: "s1", agentId: "a1", role: "guest" }).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// Write validation
// ══════════════════════════════════════════════════════════

describe("write check args", () => {
  it("accepts valid write check input", () => {
    expect(WriteCheckArgs.safeParse({ locators: ["src/a.ts"], actorId: "a1", taskId: "t1" }).success).toBe(true);
  });

  it("rejects empty locators array", () => {
    expect(WriteCheckArgs.safeParse({ locators: [], actorId: "a1", taskId: "t1" }).success).toBe(false);
  });

  it("rejects empty locator string", () => {
    expect(WriteCheckArgs.safeParse({ locators: [""], actorId: "a1", taskId: "t1" }).success).toBe(false);
  });

  it("rejects missing actorId", () => {
    expect(WriteCheckArgs.safeParse({ locators: ["src/a.ts"], taskId: "t1" }).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// Review validation
// ══════════════════════════════════════════════════════════

describe("review approve args", () => {
  it("accepts valid approve input", () => {
    expect(ReviewApproveArgs.safeParse({ reviewRequestId: "rr1", summary: "LGTM", by: "a1" }).success).toBe(true);
  });

  it("rejects empty summary", () => {
    expect(ReviewApproveArgs.safeParse({ reviewRequestId: "rr1", summary: "", by: "a1" }).success).toBe(false);
  });

  it("rejects missing 'by'", () => {
    expect(ReviewApproveArgs.safeParse({ reviewRequestId: "rr1", summary: "LGTM" }).success).toBe(false);
  });
});

describe("review block args", () => {
  it("accepts valid block input", () => {
    expect(ReviewBlockArgs.safeParse({ reviewRequestId: "rr1", summary: "Missing tests", requestedChanges: "Add tests", by: "a1" }).success).toBe(true);
  });

  it("rejects empty requestedChanges", () => {
    expect(ReviewBlockArgs.safeParse({ reviewRequestId: "rr1", summary: "Nope", requestedChanges: "", by: "a1" }).success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// Sync validation
// ══════════════════════════════════════════════════════════

describe("sync request args", () => {
  it("accepts valid sync request", () => {
    expect(SyncRequestArgs.safeParse({ taskId: "t1", requestedByAgentId: "a1", requiredAgentIds: ["a2"], reason: "manual_request" }).success).toBe(true);
  });

  it("rejects empty requiredAgentIds", () => {
    expect(SyncRequestArgs.safeParse({ taskId: "t1", requestedByAgentId: "a1", requiredAgentIds: [], reason: "manual_request" }).success).toBe(false);
  });

  it("rejects missing reason", () => {
    expect(SyncRequestArgs.safeParse({ taskId: "t1", requestedByAgentId: "a1", requiredAgentIds: ["a2"] }).success).toBe(false);
  });
});
