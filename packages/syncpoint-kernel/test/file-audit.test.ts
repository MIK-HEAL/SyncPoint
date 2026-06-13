import { describe, it, expect } from "vitest";
import {
  FileAuditDecisionKind,
  evaluateFileAuditChange,
  gateMatchesResource,
} from "../src/file-audit.js";
import { ResourceClaimMode, ResourceClaimStatus } from "../src/resource.js";
import type { ResourceRef, ResourceClaim } from "../src/resource.js";
import type { FileAuditGateContext } from "../src/file-audit.js";

// ── Helpers ──────────────────────────────────────────────

function fileRef(locator: string, overrides: Partial<ResourceRef> = {}): ResourceRef {
  return { type: "file", locator, scope: "file", metadata: "", ...overrides };
}

function makeClaim(overrides: Partial<ResourceClaim> = {}): ResourceClaim {
  return {
    id: "claim-1",
    actorId: "agent-1",
    taskId: "task-1",
    sessionId: "",
    resources: [fileRef("src/a.ts")],
    mode: ResourceClaimMode.EXCLUSIVE,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "2026-01-01T00:00:00.000Z",
    releasedAt: "",
    ...overrides,
  };
}

function makeGate(overrides: Partial<FileAuditGateContext> = {}): FileAuditGateContext {
  return { id: "gate-1", ...overrides };
}

describe("evaluateFileAuditChange", () => {
  it("returns FILE_CHANGED when no claims match", () => {
    const result = evaluateFileAuditChange({
      actorId: "agent-1",
      changedResource: fileRef("src/untracked.ts"),
      activeClaims: [makeClaim({ resources: [fileRef("src/other.ts")] })],
    });
    expect(result.kind).toBe(FileAuditDecisionKind.FILE_CHANGED);
    expect(result.shouldCreateGate).toBe(false);
  });

  it("returns CLAIMED_WRITE when own claim matches", () => {
    const result = evaluateFileAuditChange({
      actorId: "agent-1",
      changedResource: fileRef("src/a.ts"),
      activeClaims: [makeClaim({ actorId: "agent-1", resources: [fileRef("src/a.ts")] })],
    });
    expect(result.kind).toBe(FileAuditDecisionKind.CLAIMED_WRITE);
    expect(result.ownClaims).toHaveLength(1);
    expect(result.conflictingClaims).toHaveLength(0);
  });

  it("returns FILE_POLLUTION_DETECTED when conflicting exclusive claim exists", () => {
    const result = evaluateFileAuditChange({
      actorId: "agent-1",
      changedResource: fileRef("src/a.ts"),
      activeClaims: [
        makeClaim({ id: "claim-2", actorId: "agent-2", resources: [fileRef("src/a.ts")], mode: ResourceClaimMode.EXCLUSIVE }),
      ],
    });
    expect(result.kind).toBe(FileAuditDecisionKind.FILE_POLLUTION_DETECTED);
    expect(result.conflictingClaims).toHaveLength(1);
    expect(result.shouldCreateGate).toBe(true);
  });

  it("ignores conflicting shared claims", () => {
    const result = evaluateFileAuditChange({
      actorId: "agent-1",
      changedResource: fileRef("src/a.ts"),
      activeClaims: [
        makeClaim({ id: "claim-2", actorId: "agent-2", resources: [fileRef("src/a.ts")], mode: ResourceClaimMode.SHARED }),
      ],
    });
    expect(result.kind).toBe(FileAuditDecisionKind.FILE_CHANGED);
  });

  it("returns FILE_AUDIT_ALERT when blocking gate matches", () => {
    const result = evaluateFileAuditChange({
      actorId: "agent-1",
      changedResource: fileRef("src/a.ts"),
      activeClaims: [],
      blockingGates: [
        makeGate({ id: "gate-1", relatedResources: [fileRef("src/a.ts")] }),
      ],
    });
    expect(result.kind).toBe(FileAuditDecisionKind.FILE_AUDIT_ALERT);
    expect(result.relatedBlockingGateIds).toContain("gate-1");
    expect(result.shouldCreateGate).toBe(false);
  });

  it("FILE_POLLUTION takes priority over CLAIMED_WRITE", () => {
    const result = evaluateFileAuditChange({
      actorId: "agent-1",
      changedResource: fileRef("src/a.ts"),
      activeClaims: [
        makeClaim({ actorId: "agent-1", resources: [fileRef("src/a.ts")] }),
        makeClaim({ id: "claim-2", actorId: "agent-2", resources: [fileRef("src/a.ts")] }),
      ],
    });
    expect(result.kind).toBe(FileAuditDecisionKind.FILE_POLLUTION_DETECTED);
  });
});

describe("gateMatchesResource", () => {
  it("matches by relatedResources", () => {
    const gate = makeGate({ relatedResources: [fileRef("src/a.ts")] });
    expect(gateMatchesResource(gate, fileRef("src/a.ts"))).toBe(true);
  });

  it("matches by relatedFiles", () => {
    const gate = makeGate({ relatedFiles: ["src/a.ts"] });
    expect(gateMatchesResource(gate, fileRef("src/a.ts"))).toBe(true);
  });

  it("does not match unrelated resource", () => {
    const gate = makeGate({ relatedFiles: ["src/b.ts"] });
    expect(gateMatchesResource(gate, fileRef("src/a.ts"))).toBe(false);
  });

  it("handles empty gate", () => {
    const gate = makeGate();
    expect(gateMatchesResource(gate, fileRef("src/a.ts"))).toBe(false);
  });
});
