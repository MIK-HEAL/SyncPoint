/**
 * Edge case tests for MCP format utilities.
 */
import { describe, it, expect } from "vitest";
import {
  formatAgentSummary,
  formatTaskSummary,
  formatContextSnapshotSummary,
  formatProjectMemorySummary,
} from "../src/format.js";

describe("formatAgentSummary edge cases", () => {
  it("handles empty name", () => {
    const result = formatAgentSummary({
      id: "a1", name: "", role: "tester", status: "IDLE",
    });
    expect(result).toContain("****"); // empty name in bold
  });

  it("handles very long names", () => {
    const longName = "a".repeat(200);
    const result = formatAgentSummary({
      id: "a1", name: longName, role: "tester", status: "IDLE",
    });
    expect(result).toContain(longName);
    expect(result.length).toBeGreaterThan(200);
  });
});

describe("formatTaskSummary edge cases", () => {
  it("handles empty title", () => {
    const result = formatTaskSummary({
      id: "t1", title: "", status: "OPEN",
    });
    expect(result).toContain("****");
  });

  it("handles undefined ownerAgentId", () => {
    const result = formatTaskSummary({
      id: "t1", title: "Test", status: "OPEN", ownerAgentId: undefined,
    });
    expect(result).not.toContain("→");
  });
});

describe("formatContextSnapshotSummary edge cases", () => {
  it("handles array payload fields with empty arrays", () => {
    const result = formatContextSnapshotSummary({
      id: "snap-1",
      agentId: "a1",
      createdAt: "2025-01-01T00:00:00Z",
      payload: {
        goal: "Test",
        currentPhase: "",
        workingResources: [],
        completedWork: "",
        remainingWork: "",
        nextSteps: [],
        blockers: [],
        confirmedDecisions: [],
        interfaceContract: "",
        risks: [],
        resumePrompt: "",
      },
    });
    expect(result).toContain("## Snapshot snap-1");
    // Empty arrays should not produce extra lines
    expect(result).not.toContain("Resources:");
    expect(result).not.toContain("Next:");
    expect(result).not.toContain("Blockers:");
  });

  it("handles undefined payload fields gracefully", () => {
    const result = formatContextSnapshotSummary({
      id: "snap-2",
      agentId: "a2",
      createdAt: "2025-01-01T00:00:00Z",
      payload: {} as any,
    });
    expect(result).toContain("(empty)");
    expect(result).not.toContain("undefined");
  });
});

describe("formatProjectMemorySummary edge cases", () => {
  it("handles empty content", () => {
    const result = formatProjectMemorySummary({
      id: "pm-1",
      category: "architecture",
      title: "Empty Memory",
      content: "",
      status: "draft",
      confidence: "low",
      scope: "project",
      tags: [],
      sourceType: "human",
      sourceRef: "",
      taskId: null,
      createdBy: "test",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
    expect(result).toContain("### Empty Memory");
    expect(result).toContain("Category: architecture");
  });

  it("handles many tags", () => {
    const result = formatProjectMemorySummary({
      id: "pm-2",
      category: "convention",
      title: "Tagged Memory",
      content: "Content with many tags.",
      status: "approved",
      confidence: "high",
      scope: "project",
      tags: ["a", "b", "c", "d", "e", "f", "g", "h"],
      sourceType: "agent",
      sourceRef: "ref-1",
      taskId: "t1",
      createdBy: "cursor",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
    expect(result).toContain("Category: convention");
    expect(result).toContain("Status: approved");
  });
});
