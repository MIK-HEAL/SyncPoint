/**
 * Tests for CLI formatter helper functions.
 */
import { describe, it, expect } from "vitest";
import {
  indent,
  blockerTypeLabel,
  blockerReasonLabel,
  suggestedAction,
  agentLabel,
  formatDeadline,
  formatVoteCounts,
  eventSummary,
} from "../src/commands/formatter-helpers.js";

describe("indent", () => {
  it("indents single line by 1 level", () => {
    expect(indent("hello")).toBe("  hello");
  });

  it("indents multiline by 2 levels", () => {
    expect(indent("a\nb", 2)).toBe("    a\n    b");
  });

  it("default level is 1", () => {
    expect(indent("test")).toBe("  test");
  });
});

describe("blockerTypeLabel", () => {
  it("maps sync_gate", () => expect(blockerTypeLabel("sync_gate")).toBe("Sync Gate"));
  it("maps checkpoint_review", () => expect(blockerTypeLabel("checkpoint_review")).toBe("Checkpoint Review"));
  it("maps handoff", () => expect(blockerTypeLabel("handoff")).toBe("Pending Handoff"));
  it("maps review", () => expect(blockerTypeLabel("review")).toBe("Review Required"));
  it("maps operation", () => expect(blockerTypeLabel("operation")).toBe("Operation"));
  it("returns unknown types as-is", () => expect(blockerTypeLabel("custom_type")).toBe("custom_type"));
});

describe("blockerReasonLabel", () => {
  it("maps resource_conflict", () => expect(blockerReasonLabel("resource_conflict")).toBe("resource ownership conflict"));
  it("maps checkpoint_required", () => expect(blockerReasonLabel("checkpoint_required")).toBe("checkpoint requires approval"));
  it("maps review_requested", () => expect(blockerReasonLabel("review_requested")).toBe("review not started"));
  it("maps handoff_pending", () => expect(blockerReasonLabel("handoff_pending")).toBe("handoff waiting for acceptance"));
  it("maps operation_awaiting_approval", () => expect(blockerReasonLabel("operation_awaiting_approval")).toBe("operation awaiting approval"));
  it("returns unknown reasons as-is", () => expect(blockerReasonLabel("unknown_reason")).toBe("unknown_reason"));
});

describe("suggestedAction", () => {
  it("suggests sync ack for sync_gate", () => {
    const result = suggestedAction({
      id: "g1", agentId: "a1", agentName: "test", type: "sync_gate", reason: "manual_request",
      status: "SYNC_REQUESTED", description: "", blockedAgentNames: [],
      requiredAgents: [{ id: "a1", name: "test" }],
      gateDetails: undefined,
    });
    expect(result).toContain("syncpoint sync ack");
    expect(result).toContain("syncpoint sync resolve");
  });

  it("suggests checkpoint review approve", () => {
    const result = suggestedAction({
      id: "r1", agentId: "a1", agentName: "test", type: "checkpoint_review", reason: "checkpoint_required",
      status: "WAITING_APPROVAL", description: "", blockedAgentNames: [],
      requiredAgents: [{ id: "a1", name: "test" }],
      gateDetails: undefined,
    });
    expect(result).toContain("syncpoint checkpoint review approve");
  });

  it("suggests handoff accept", () => {
    const result = suggestedAction({
      id: "h1", agentId: "a1", agentName: "test", type: "handoff", reason: "handoff_pending",
      status: "PENDING", description: "", blockedAgentNames: [],
      requiredAgents: [{ id: "a1", name: "test" }],
      gateDetails: undefined,
    });
    expect(result).toContain("syncpoint handoff accept");
  });

  it("suggests operation check for conflict", () => {
    const result = suggestedAction({
      id: "o1", agentId: "a1", agentName: "test", type: "operation", reason: "operation_conflict",
      status: "PENDING", description: "", blockedAgentNames: [],
      requiredAgents: [{ id: "a1", name: "test" }],
      gateDetails: undefined,
    });
    expect(result).toContain("syncpoint operation check");
    expect(result).toContain("syncpoint operation submit");
  });

  it("returns empty string for unknown types", () => {
    const result = suggestedAction({
      id: "x1", agentId: "a1", agentName: "test", type: "unknown" as any, reason: "test",
      status: "OPEN", description: "", blockedAgentNames: [],
      requiredAgents: [],
      gateDetails: undefined,
    });
    expect(result).toBe("");
  });
});

describe("agentLabel", () => {
  const agents = [{ id: "a1", name: "Alice" }, { id: "a2", name: "Bob" }];

  it("returns agent name when found", () => {
    expect(agentLabel("a1", agents)).toBe("Alice");
    expect(agentLabel("a2", agents)).toBe("Bob");
  });

  it("returns id when not found", () => {
    expect(agentLabel("a3", agents)).toBe("a3");
  });
});

describe("formatVoteCounts", () => {
  it("formats all vote types with defaults", () => {
    const result = formatVoteCounts({ approve: 2, reject: 1 });
    expect(result).toBe("approve:2 reject:1 abstain:0 escalate:0");
  });

  it("includes all four vote types", () => {
    const result = formatVoteCounts({});
    expect(result).toContain("approve:0");
    expect(result).toContain("reject:0");
    expect(result).toContain("abstain:0");
    expect(result).toContain("escalate:0");
  });
});

describe("eventSummary", () => {
  it("extracts locator from JSON detail", () => {
    expect(eventSummary({ id: "e1", eventType: "FILE_CHANGED", entityType: "file", entityId: "f1", detail: JSON.stringify({ locator: "src/a.ts" }), createdAt: "2025-01-01T00:00:00Z" }))
      .toContain("locator=src/a.ts");
  });

  it("extracts decision from JSON detail", () => {
    expect(eventSummary({ id: "e2", eventType: "REVIEW_DECIDED", entityType: "review", entityId: "r1", detail: JSON.stringify({ decision: "approved" }), createdAt: "2025-01-01T00:00:00Z" }))
      .toContain("decision=approved");
  });

  it("returns empty string for empty detail", () => {
    expect(eventSummary({ id: "e3", eventType: "TASK_CREATED", entityType: "task", entityId: "t1", detail: "", createdAt: "2025-01-01T00:00:00Z" })).toBe("");
  });

  it("returns raw detail on parse failure", () => {
    expect(eventSummary({ id: "e4", eventType: "AGENT_REGISTERED", entityType: "agent", entityId: "a1", detail: "plain text", createdAt: "2025-01-01T00:00:00Z" }))
      .toBe("plain text");
  });
});
