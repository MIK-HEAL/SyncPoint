import { describe, expect, it } from "vitest";
import { ResourceClaimMode, ResourceClaimStatus } from "./resource.js";
import type { ResourceClaim, ResourceRef } from "./resource.js";
import {
  FileAuditDecisionKind,
  evaluateFileAuditChange,
  parseRelatedFileLocators,
} from "./file-audit.js";

function resource(locator: string): ResourceRef {
  return { type: "file", locator, metadata: "" };
}

function claim(overrides: Partial<ResourceClaim> & { id: string; actorId: string; taskId: string; locator: string }): ResourceClaim {
  return {
    id: overrides.id,
    actorId: overrides.actorId,
    taskId: overrides.taskId,
    sessionId: "s1",
    resources: [resource(overrides.locator)],
    mode: overrides.mode ?? ResourceClaimMode.EXCLUSIVE,
    status: overrides.status ?? ResourceClaimStatus.ACTIVE,
    createdAt: "2026-01-01T00:00:00.000Z",
    releasedAt: "",
  };
}

describe("evaluateFileAuditChange", () => {
  it("classifies unclaimed file changes as FILE_CHANGED", () => {
    const decision = evaluateFileAuditChange({
      actorId: "agent-b",
      changedResource: resource("src/auth.ts"),
      activeClaims: [],
    });

    expect(decision.kind).toBe(FileAuditDecisionKind.FILE_CHANGED);
    expect(decision.shouldCreateGate).toBe(false);
  });

  it("classifies writes to the current agent's own claim", () => {
    const decision = evaluateFileAuditChange({
      actorId: "agent-a",
      changedResource: resource("src/auth.ts"),
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", taskId: "task-a", locator: "src/auth.ts" })],
    });

    expect(decision.kind).toBe(FileAuditDecisionKind.CLAIMED_WRITE);
    expect(decision.ownClaims.map(c => c.id)).toEqual(["claim-a"]);
    expect(decision.shouldCreateGate).toBe(false);
  });

  it("detects pollution when another agent owns an exclusive claim", () => {
    const decision = evaluateFileAuditChange({
      actorId: "agent-b",
      changedResource: resource("src/auth.ts"),
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", taskId: "task-a", locator: "src/auth.ts" })],
    });

    expect(decision.kind).toBe(FileAuditDecisionKind.FILE_POLLUTION_DETECTED);
    expect(decision.conflictingClaims.map(c => c.id)).toEqual(["claim-a"]);
    expect(decision.shouldCreateGate).toBe(true);
  });

  it("raises an audit alert when the agent is already blocked on the changed file", () => {
    const decision = evaluateFileAuditChange({
      actorId: "agent-b",
      changedResource: resource("src/auth.ts"),
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", taskId: "task-a", locator: "src/auth.ts" })],
      blockingGates: [{ id: "gate-1", relatedFiles: ["src/auth.ts"] }],
    });

    expect(decision.kind).toBe(FileAuditDecisionKind.FILE_AUDIT_ALERT);
    expect(decision.relatedBlockingGateIds).toEqual(["gate-1"]);
    expect(decision.shouldCreateGate).toBe(false);
  });
});

describe("parseRelatedFileLocators", () => {
  it("splits comma-separated and overlap-display locators", () => {
    expect(parseRelatedFileLocators("src/a.ts ↔ src/b.ts, src/c.ts")).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });
});
