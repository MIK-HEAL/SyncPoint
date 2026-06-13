/**
 * Tests for MCP format utilities — pure formatting functions.
 */
import { describe, it, expect } from "vitest";
import {
  formatAgentSummary,
  formatTaskSummary,
  formatCheckpointSummary,
  formatContextSnapshotSummary,
  formatProjectMemorySummary,
  formatToolResult,
} from "../src/format.js";

describe("formatAgentSummary", () => {
  it("formats an agent with all fields", () => {
    const result = formatAgentSummary({
      id: "agent-1",
      name: "cursor",
      role: "frontend",
      status: "IDLE",
    });
    expect(result).toBe("- **cursor** (frontend) — IDLE [agent-1]");
  });

  it("handles different roles and statuses", () => {
    const result = formatAgentSummary({
      id: "agent-2",
      name: "claude-code",
      role: "reviewer",
      status: "BLOCKED",
    });
    expect(result).toContain("claude-code");
    expect(result).toContain("reviewer");
    expect(result).toContain("BLOCKED");
  });
});

describe("formatTaskSummary", () => {
  it("formats a task with owner", () => {
    const result = formatTaskSummary({
      id: "task-1",
      title: "Build MCP server",
      status: "IN_PROGRESS",
      ownerAgentId: "agent-1",
    });
    expect(result).toBe("- **Build MCP server** — IN_PROGRESS → agent-1 [task-1]");
  });

  it("formats a task without owner", () => {
    const result = formatTaskSummary({
      id: "task-2",
      title: "Review PR",
      status: "OPEN",
    });
    expect(result).toBe("- **Review PR** — OPEN [task-2]");
  });

  it("formats a task with null owner", () => {
    const result = formatTaskSummary({
      id: "task-3",
      title: "Deploy",
      status: "COMPLETED",
      ownerAgentId: null,
    });
    expect(result).toBe("- **Deploy** — COMPLETED [task-3]");
  });
});

describe("formatCheckpointSummary", () => {
  it("formats a checkpoint without sync flag", () => {
    const result = formatCheckpointSummary({
      id: "cp-1",
      summary: "Initial scaffold",
      createdAt: "2025-01-15T10:30:00Z",
    });
    expect(result).toBe("- [2025-01-15T10:30:00Z] Initial scaffold [cp-1]");
  });

  it("formats a checkpoint with sync flag", () => {
    const result = formatCheckpointSummary({
      id: "cp-2",
      summary: "Checkpoint needing sync",
      createdAt: "2025-01-16T14:00:00Z",
      needSync: true,
    });
    expect(result).toContain("⚠ NEEDS_SYNC");
    expect(result).toContain("Checkpoint needing sync");
  });

  it("formats a checkpoint with explicit false sync flag", () => {
    const result = formatCheckpointSummary({
      id: "cp-3",
      summary: "Normal checkpoint",
      createdAt: "2025-01-17T09:00:00Z",
      needSync: false,
    });
    expect(result).not.toContain("NEEDS_SYNC");
  });
});

describe("formatContextSnapshotSummary", () => {
  it("formats a full snapshot payload", () => {
    const result = formatContextSnapshotSummary({
      id: "snap-1",
      agentId: "agent-1",
      createdAt: "2025-06-13T12:00:00Z",
      payload: {
        goal: "Build MCP server",
        currentPhase: "implementation",
        workingResources: ["src/server.ts", "src/tools.ts"],
        completedWork: "Scaffolded tools",
        remainingWork: "Add tests",
        nextSteps: ["Write unit tests", "Run integration tests"],
        blockers: ["Need review approval"],
        confirmedDecisions: ["Use stdio transport"],
        interfaceContract: "",
        risks: [],
        resumePrompt: "Continue building",
      },
    });
    expect(result).toContain("## Snapshot snap-1");
    expect(result).toContain("Agent: agent-1");
    expect(result).toContain("Build MCP server");
    expect(result).toContain("implementation");
    expect(result).toContain("src/server.ts, src/tools.ts");
    expect(result).toContain("Scaffolded tools");
    expect(result).toContain("Add tests");
    expect(result).toContain("Write unit tests, Run integration tests");
    expect(result).toContain("Need review approval");
  });

  it("formats a minimal snapshot with empty fields", () => {
    const result = formatContextSnapshotSummary({
      id: "snap-2",
      agentId: "agent-2",
      createdAt: "2025-06-13T12:00:00Z",
      payload: {},
    });
    expect(result).toContain("(empty)");
    expect(result).not.toContain("Resources:");
    expect(result).not.toContain("Completed:");
  });

  it("uses summary field when goal is empty", () => {
    const result = formatContextSnapshotSummary({
      id: "snap-3",
      agentId: "agent-3",
      summary: "Fallback summary text",
      createdAt: "2025-06-13T12:00:00Z",
      payload: {},
    });
    expect(result).toContain("Fallback summary text");
  });
});

describe("formatProjectMemorySummary", () => {
  it("formats a project memory entry", () => {
    const result = formatProjectMemorySummary({
      id: "pm-1",
      category: "architecture",
      title: "MCP Transport",
      content: "Use stdio for local MCP communication.",
      status: "approved",
      confidence: "high",
      scope: "project",
      tags: ["mcp", "transport"],
      sourceType: "human",
      sourceRef: "",
      taskId: null,
      createdBy: "test",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
    expect(result).toContain("### MCP Transport");
    expect(result).toContain("Category: architecture");
    expect(result).toContain("Status: approved");
    expect(result).toContain("Confidence: high");
    expect(result).toContain("Use stdio for local MCP communication.");
  });
});

describe("formatToolResult", () => {
  it("formats a simple data object as JSON", () => {
    const result = formatToolResult({ ok: true, count: 3 });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBe(3);
  });

  it("formats nested objects", () => {
    const result = formatToolResult({
      session: { id: "s1", title: "Test" },
      actions: [{ action: "plan-tasks" }],
    });
    const parsed = JSON.parse(result);
    expect(parsed.session.id).toBe("s1");
    expect(parsed.actions).toHaveLength(1);
  });

  it("pretty-prints with 2-space indent", () => {
    const result = formatToolResult({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}');
  });
});
