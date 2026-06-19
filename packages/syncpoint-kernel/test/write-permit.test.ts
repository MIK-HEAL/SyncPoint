import { describe, it, expect } from "vitest";
import {
  WriteIntent,
  WritePermitStatus,
  WriteDecisionReason,
  evaluateWriteDecision,
} from "../src/write-permit.js";
import { OperationStatus } from "../src/operation.js";
import { ResourceClaimMode, ResourceClaimStatus } from "../src/resource.js";
import type { ResourceRef, ResourceClaim } from "../src/resource.js";
import type { Operation } from "../src/operation.js";
import type { SyncGate } from "../src/sync-gate.js";
import { SyncGateStatus, SyncGateReason, DEFAULT_GATE_POLICY } from "../src/sync-gate.js";
import type { WriteDecisionInput } from "../src/write-permit.js";

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

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    type: "code_patch",
    actorId: "agent-1",
    taskId: "task-1",
    sessionId: "",
    title: "test op",
    summary: "test",
    targetResources: [fileRef("src/a.ts")],
    payloadRef: "",
    status: OperationStatus.APPROVED,
    checkResult: null,
    decisionSummary: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeGate(overrides: Partial<SyncGate> = {}): SyncGate {
  return {
    id: "gate-1",
    sessionId: "",
    taskId: "task-1",
    requestedByAgentId: "agent-1",
    requiredAgentIds: [],
    ackedAgentIds: [],
    reason: SyncGateReason.MANUAL_REQUEST,
    description: "",
    relatedFiles: [],
    relatedResources: [],
    relatedCheckpointId: "",
    relatedClaimIds: [],
    status: SyncGateStatus.SYNC_REQUESTED,
    decisionSummary: "",
    policy: DEFAULT_GATE_POLICY,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Basic validation ─────────────────────────────────────

describe("evaluateWriteDecision", () => {
  const baseInput: WriteDecisionInput = {
    actorId: "agent-1",
    taskId: "task-1",
    resources: [fileRef("src/a.ts")],
    intent: WriteIntent.MODIFY,
    activeClaims: [],
    activeGates: [],
  };

  describe("input validation", () => {
    it("blocks when no resources provided", () => {
      const result = evaluateWriteDecision({ ...baseInput, resources: [] });
      expect(result.permitted).toBe(false);
      expect(result.reason).toBe(WriteDecisionReason.BLOCKED);
      expect(result.blockers.some(b => b.type === "resource")).toBe(true);
    });

    it("blocks when resource fails schema validation", () => {
      const result = evaluateWriteDecision({
        ...baseInput,
        resources: [{ type: "file", locator: "", scope: "file" as any, metadata: "" }],
      });
      expect(result.permitted).toBe(false);
    });
  });

  describe("claim-based authorization", () => {
    it("permits write with owned exclusive claim", () => {
      const claim = makeClaim({
        actorId: "agent-1",
        taskId: "task-1",
        resources: [fileRef("src/a.ts")],
        mode: ResourceClaimMode.EXCLUSIVE,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeClaims: [claim],
      });
      expect(result.permitted).toBe(true);
      expect(result.reason).toBe(WriteDecisionReason.OWNED_CLAIM);
    });

    it("permits write with shared claim", () => {
      const claim = makeClaim({
        actorId: "agent-1",
        taskId: "task-1",
        resources: [fileRef("src/a.ts")],
        mode: ResourceClaimMode.SHARED,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeClaims: [claim],
      });
      expect(result.permitted).toBe(true);
      expect(result.reason).toBe(WriteDecisionReason.SHARED_CLAIM);
    });

    it("blocks when another agent has exclusive claim", () => {
      const claim = makeClaim({
        id: "other-claim",
        actorId: "agent-2",
        taskId: "task-2",
        resources: [fileRef("src/a.ts")],
        mode: ResourceClaimMode.EXCLUSIVE,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeClaims: [claim],
      });
      expect(result.permitted).toBe(false);
      expect(result.blockers.some(b => b.type === "resource_claim")).toBe(true);
    });

    it("does not block on own claim from different task", () => {
      // Different task → treated as separate claim for conflict check
      const claim = makeClaim({
        actorId: "agent-1",
        taskId: "task-2",  // different task
        resources: [fileRef("src/a.ts")],
        mode: ResourceClaimMode.EXCLUSIVE,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeClaims: [claim],
      });
      // Should be blocked — same actor but different task means no covering claim
      expect(result.permitted).toBe(false);
    });

    it("ignores non-active claims", () => {
      const claim = makeClaim({
        actorId: "agent-2",
        resources: [fileRef("src/a.ts")],
        mode: ResourceClaimMode.EXCLUSIVE,
        status: ResourceClaimStatus.RELEASED,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeClaims: [claim],
      });
      // No active claim blocks, but also no covering claim → blocked
      expect(result.permitted).toBe(false);
    });
  });

  describe("operation-based authorization", () => {
    it("permits write with approved operation", () => {
      const op = makeOperation({
        actorId: "agent-1",
        taskId: "task-1",
        targetResources: [fileRef("src/a.ts")],
        status: OperationStatus.APPROVED,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        operation: op,
        activeClaims: [],
      });
      expect(result.permitted).toBe(true);
      expect(result.reason).toBe(WriteDecisionReason.APPROVED_OPERATION);
    });

    it("blocks non-approved operation", () => {
      const op = makeOperation({
        actorId: "agent-1",
        taskId: "task-1",
        targetResources: [fileRef("src/a.ts")],
        status: OperationStatus.DRAFT,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        operation: op,
      });
      expect(result.permitted).toBe(false);
      expect(result.blockers.some(b => b.type === "authorization")).toBe(true);
    });

    it("blocks operation for different actor", () => {
      const op = makeOperation({
        actorId: "agent-2",
        taskId: "task-2",
        status: OperationStatus.APPROVED,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        operation: op,
      });
      expect(result.permitted).toBe(false);
    });

    it("blocks operation with no target resources", () => {
      const op = makeOperation({
        actorId: "agent-1",
        taskId: "task-1",
        targetResources: [],
        status: OperationStatus.APPROVED,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        operation: op,
      });
      expect(result.permitted).toBe(false);
    });
  });

  describe("sync gate blocking", () => {
    it("blocks when an unresolved gate blocks the actor", () => {
      const gate = makeGate({
        taskId: "task-1",
        requiredAgentIds: ["agent-1"],
        status: SyncGateStatus.SYNC_REQUESTED,
        relatedResources: [fileRef("src/a.ts")],
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeGates: [gate],
      });
      expect(result.permitted).toBe(false);
      expect(result.blockers.some(b => b.type === "sync_gate")).toBe(true);
    });

    it("ignores resolved gates", () => {
      const gate = makeGate({
        taskId: "task-1",
        requiredAgentIds: ["agent-1"],
        status: SyncGateStatus.READY_TO_CONTINUE,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeGates: [gate],
      });
      // Blocked by authorization (no claim/op), not by gate
      expect(result.blockers.some(b => b.type === "sync_gate")).toBe(false);
    });

    it("ignores gates for different task", () => {
      const gate = makeGate({
        taskId: "task-2",
        requiredAgentIds: ["agent-1"],
        status: SyncGateStatus.SYNC_REQUESTED,
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeGates: [gate],
      });
      expect(result.blockers.some(b => b.type === "sync_gate")).toBe(false);
    });
  });

  describe("constraint decision", () => {
    it("blocks when constraint runtime unavailable", () => {
      const result = evaluateWriteDecision({
        ...baseInput,
        constraintDecision: {
          permitted: true,
          runtimeUnavailable: { message: "runtime down" },
        },
      });
      expect(result.permitted).toBe(false);
      expect(result.blockers.some(b => b.type === "constraint_runtime")).toBe(true);
    });

    it("blocks on constraint violation", () => {
      const result = evaluateWriteDecision({
        ...baseInput,
        constraintDecision: {
          permitted: false,
          blockers: [{ rule: "no-delete", message: "deletion forbidden" }],
        },
      });
      expect(result.permitted).toBe(false);
      expect(result.blockers.some(b => b.type === "constraint_runtime")).toBe(true);
    });

    it("passes when constraint decision permits", () => {
      const claim = makeClaim({
        actorId: "agent-1",
        taskId: "task-1",
        resources: [fileRef("src/a.ts")],
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        activeClaims: [claim],
        constraintDecision: { permitted: true },
      });
      expect(result.permitted).toBe(true);
    });
  });

  describe("session scoping", () => {
    it("filters claims by session when sessionId set", () => {
      const claimMatch = makeClaim({
        id: "claim-match",
        actorId: "agent-1",
        taskId: "task-1",
        sessionId: "sess-1",
        resources: [fileRef("src/a.ts")],
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        sessionId: "sess-1",
        activeClaims: [claimMatch],
      });
      expect(result.permitted).toBe(true);
    });

    it("ignores claims from different session", () => {
      const claimOther = makeClaim({
        id: "claim-other",
        actorId: "agent-1",
        taskId: "task-1",
        sessionId: "sess-2",
        resources: [fileRef("src/a.ts")],
      });
      const result = evaluateWriteDecision({
        ...baseInput,
        sessionId: "sess-1",
        activeClaims: [claimOther],
      });
      // Claim scoped to sess-2, input scoped to sess-1 → no covering claim
      expect(result.permitted).toBe(false);
    });
  });
});
