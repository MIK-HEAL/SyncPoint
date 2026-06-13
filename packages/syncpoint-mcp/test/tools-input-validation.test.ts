/**
 * Tests for MCP tool input Zod schema validation.
 *
 * Validates that tool argument schemas correctly accept/reject inputs.
 * These tests use the actual Zod schemas extracted from tool definitions.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Constraint check tool args ──
const ConstraintCheckArgsSchema = z.object({
  action: z.enum(["resume", "start_assignment", "wake_start", "operation_submit", "operation_apply"]),
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  assignmentId: z.string().optional(),
  wakeRequestId: z.string().optional(),
  operationId: z.string().optional(),
  touchedResources: z.array(z.string()).optional(),
});

// ── Project memory add args ──
const ProjectMemoryAddArgsSchema = z.object({
  category: z.enum(["architecture", "convention", "decision", "constraint", "context", "other"]),
  title: z.string().min(1).max(256),
  content: z.string().min(1),
  scope: z.enum(["project", "task"]).default("project"),
  tags: z.array(z.string()).default([]),
  kind: z.enum(["fact", "hard_constraint", "soft_guideline"]).default("fact"),
  projectionTarget: z.enum(["protocol_gate", "context_capsule", "both"]).default("context_capsule"),
  appliesTo: z.object({
    files: z.array(z.string()).optional(),
    tasks: z.array(z.string()).optional(),
    agents: z.array(z.string()).optional(),
    sessions: z.array(z.string()).optional(),
  }).default({}),
  severity: z.enum(["info", "warning", "blocking"]).default("info"),
  validity: z.object({ status: z.enum(["fresh", "stale", "expired"]) }).default({ status: "fresh" }),
  validatorType: z.enum(["custom", "file_exists", "pattern_match"]).optional(),
  validatorConfig: z.record(z.unknown()).optional(),
  createdBy: z.string().min(1),
  taskId: z.string().optional(),
});

// ── Project memory search args ──
const ProjectMemorySearchArgsSchema = z.object({
  query: z.string(),
  category: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ── Project memory approve args ──
const ProjectMemoryApproveArgsSchema = z.object({
  id: z.string().min(1),
  updatedBy: z.string().min(1),
});

// ── Write check args ──
const WriteCheckArgsSchema = z.object({
  locators: z.array(z.string()).min(1),
  actorId: z.string().min(1),
  taskId: z.string().min(1),
});

// ── Sync gate request args ──
const SyncGateRequestArgsSchema = z.object({
  taskId: z.string().min(1),
  requestedByAgentId: z.string().min(1),
  requiredAgentIds: z.array(z.string()).min(1),
  reason: z.string().min(1),
  description: z.string().optional(),
  policy: z.string().optional(),
  checkpointReviewId: z.string().optional(),
});

// ── Loop resume args ──
const LoopResumeArgsSchema = z.object({
  taskId: z.string(),
  agentId: z.string().optional(),
  provider: z.string().optional(),
  format: z.enum(["system-prompt", "cursorrules", "agents-md", "checkpoint-md", "clipboard"]).optional(),
  contextMode: z.string().optional(),
  sessionId: z.string().optional(),
});

// ── Loop checkpoint args ──
const LoopCheckpointArgsSchema = z.object({
  taskId: z.string(),
  agentId: z.string().min(1),
  summary: z.string().min(1),
  progress: z.string().optional(),
  nextSteps: z.string().optional(),
  goal: z.string().optional(),
  phase: z.string().optional(),
  completedWork: z.string().optional(),
  remainingWork: z.string().optional(),
  workingResources: z.array(z.string()).optional(),
  risks: z.string().optional(),
  blockers: z.string().optional(),
  needSync: z.boolean().optional(),
});

// ══════════════════════════════════════════════════════════

describe("constraint check args", () => {
  it("accepts valid resume action", () => {
    const result = ConstraintCheckArgsSchema.safeParse({
      action: "resume", taskId: "t1", agentId: "a1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts start_assignment action", () => {
    const result = ConstraintCheckArgsSchema.safeParse({
      action: "start_assignment", assignmentId: "as1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts operation_submit with operationId", () => {
    const result = ConstraintCheckArgsSchema.safeParse({
      action: "operation_submit", operationId: "op1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = ConstraintCheckArgsSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts touchedResources override", () => {
    const result = ConstraintCheckArgsSchema.safeParse({
      action: "resume", taskId: "t1", agentId: "a1",
      touchedResources: ["src/file.ts"],
    });
    expect(result.success).toBe(true);
  });
});

describe("project memory add args", () => {
  it("accepts minimal valid input", () => {
    const result = ProjectMemoryAddArgsSchema.safeParse({
      category: "decision",
      title: "Use stdio",
      content: "MCP uses stdio transport.",
      createdBy: "test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = ProjectMemoryAddArgsSchema.safeParse({
      category: "decision", title: "", content: "test", createdBy: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = ProjectMemoryAddArgsSchema.safeParse({
      category: "decision", title: "Test", content: "", createdBy: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = ProjectMemoryAddArgsSchema.safeParse({
      category: "invalid", title: "Test", content: "test", createdBy: "test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts full constraint input", () => {
    const result = ProjectMemoryAddArgsSchema.safeParse({
      category: "constraint",
      title: "No raw SQL",
      content: "All DB access through repositories.",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
      appliesTo: { files: ["src/**/*.ts"] },
      severity: "blocking",
      validity: { status: "fresh" },
      validatorType: "custom",
      validatorConfig: { message: "DB access violation", actions: ["review"] },
      createdBy: "test",
    });
    expect(result.success).toBe(true);
  });
});

describe("project memory search args", () => {
  it("accepts query", () => {
    const result = ProjectMemorySearchArgsSchema.safeParse({ query: "MCP" });
    expect(result.success).toBe(true);
  });

  it("rejects empty query", () => {
    const result = ProjectMemorySearchArgsSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("accepts optional filters", () => {
    const result = ProjectMemorySearchArgsSchema.safeParse({
      query: "MCP", category: "architecture", status: "approved", limit: 5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    const result = ProjectMemorySearchArgsSchema.safeParse({ query: "MCP", limit: 200 });
    expect(result.success).toBe(false);
  });
});

describe("project memory approve args", () => {
  it("accepts valid args", () => {
    const result = ProjectMemoryApproveArgsSchema.safeParse({
      id: "pm-1", updatedBy: "test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = ProjectMemoryApproveArgsSchema.safeParse({ id: "", updatedBy: "test" });
    expect(result.success).toBe(false);
  });
});

describe("write check args", () => {
  it("accepts valid args", () => {
    const result = WriteCheckArgsSchema.safeParse({
      locators: ["src/file.ts"], actorId: "a1", taskId: "t1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty locators", () => {
    const result = WriteCheckArgsSchema.safeParse({
      locators: [], actorId: "a1", taskId: "t1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing actorId", () => {
    const result = WriteCheckArgsSchema.safeParse({
      locators: ["src/file.ts"], taskId: "t1",
    });
    expect(result.success).toBe(false);
  });
});

describe("sync gate request args", () => {
  it("accepts valid args", () => {
    const result = SyncGateRequestArgsSchema.safeParse({
      taskId: "t1",
      requestedByAgentId: "a1",
      requiredAgentIds: ["a1", "a2"],
      reason: "manual_request",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty requiredAgentIds", () => {
    const result = SyncGateRequestArgsSchema.safeParse({
      taskId: "t1",
      requestedByAgentId: "a1",
      requiredAgentIds: [],
      reason: "manual_request",
    });
    expect(result.success).toBe(false);
  });
});

describe("loop resume args", () => {
  it("accepts minimal valid input", () => {
    const result = LoopResumeArgsSchema.safeParse({ taskId: "t1" });
    expect(result.success).toBe(true);
  });

  it("accepts with optional fields", () => {
    const result = LoopResumeArgsSchema.safeParse({
      taskId: "t1", agentId: "a1", format: "system-prompt", contextMode: "snapshot-only",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty taskId", () => {
    const result = LoopResumeArgsSchema.safeParse({ taskId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid format", () => {
    const result = LoopResumeArgsSchema.safeParse({ taskId: "t1", format: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("loop checkpoint args", () => {
  it("accepts valid args", () => {
    const result = LoopCheckpointArgsSchema.safeParse({
      taskId: "t1", agentId: "a1", summary: "Scaffold complete",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty summary", () => {
    const result = LoopCheckpointArgsSchema.safeParse({
      taskId: "t1", agentId: "a1", summary: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts with all optional fields", () => {
    const result = LoopCheckpointArgsSchema.safeParse({
      taskId: "t1",
      agentId: "a1",
      summary: "Done",
      progress: "50%",
      nextSteps: "Add tests",
      goal: "Build MCP",
      phase: "implementation",
      completedWork: "Scaffold",
      remainingWork: "Tests",
      workingResources: ["src/tools.ts"],
      risks: "None",
      blockers: "None",
      needSync: false,
    });
    expect(result.success).toBe(true);
  });
});
