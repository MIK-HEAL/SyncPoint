import { describe, expect, it } from "vitest";
import { OperationStatus, type Operation } from "../src/operation.js";
import { ResourceClaimMode, ResourceClaimStatus, type ResourceClaim, type ResourceRef } from "../src/resource.js";
import { SyncGateReason, SyncGateStatus, type SyncGate } from "../src/sync-gate.js";
import { evaluateWriteDecision, WriteDecisionReason, WriteIntent } from "../src/write-permit.js";

const ts = "2026-01-01T00:00:00.000Z";

function resource(locator: string): ResourceRef {
  return { type: "file", locator, metadata: "", scope: "file" as const };
}

function claim(input: { id: string; actorId: string; taskId?: string; locator: string; mode?: ResourceClaimMode }): ResourceClaim {
  return {
    id: input.id,
    actorId: input.actorId,
    taskId: input.taskId ?? "task-1",
    sessionId: "session-1",
    resources: [resource(input.locator)],
    mode: input.mode ?? ResourceClaimMode.EXCLUSIVE,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: ts,
    releasedAt: "",
  };
}

function gate(overrides?: Partial<SyncGate>): SyncGate {
  return {
    id: "gate-1",
    sessionId: "session-1",
    taskId: "task-1",
    requestedByAgentId: "agent-b",
    requiredAgentIds: ["agent-a", "agent-b"],
    ackedAgentIds: ["agent-a", "agent-b"],
    reason: SyncGateReason.RESOURCE_CONFLICT,
    description: "resource conflict",
    relatedFiles: ["src/auth.js"],
    relatedResources: [resource("src/auth.js")],
    relatedCheckpointId: "",
    relatedClaimIds: [],
    status: SyncGateStatus.SYNC_ACKED,
    decisionSummary: "",
    policy: { kind: "all_required", timeoutAction: "escalate" } as SyncGate["policy"],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function operation(overrides?: Partial<Operation>): Operation {
  return {
    id: "op-1",
    type: "code_patch",
    actorId: "agent-a",
    taskId: "task-1",
    sessionId: "session-1",
    title: "patch",
    summary: "",
    targetResources: [resource("src/auth.js")],
    payloadRef: "",
    status: OperationStatus.APPROVED,
    checkResult: null,
    decisionSummary: "",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("evaluateWriteDecision", () => {
  it("permits a write covered by the actor's exclusive claim", () => {
    const decision = evaluateWriteDecision({
      actorId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      resources: [resource("src/auth.js")],
      intent: WriteIntent.MODIFY,
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", locator: "src/auth.js" })],
      activeGates: [],
    });

    expect(decision.permitted).toBe(true);
    expect(decision.reason).toBe(WriteDecisionReason.OWNED_CLAIM);
  });

  it("denies a write covered by another actor's exclusive claim", () => {
    const decision = evaluateWriteDecision({
      actorId: "agent-b",
      taskId: "task-1",
      sessionId: "session-1",
      resources: [resource("src/auth.js")],
      intent: WriteIntent.MODIFY,
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", locator: "src/auth.js" })],
      activeGates: [],
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers.map(blocker => blocker.type)).toContain("resource_claim");
  });

  it("keeps SYNC_ACKED gates blocking until resolved", () => {
    const decision = evaluateWriteDecision({
      actorId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      resources: [resource("src/auth.js")],
      intent: WriteIntent.MODIFY,
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", locator: "src/auth.js" })],
      activeGates: [gate()],
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers.map(blocker => blocker.type)).toContain("sync_gate");
  });

  it("permits a write authorized by an approved operation", () => {
    const decision = evaluateWriteDecision({
      actorId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      resources: [resource("src/auth.js")],
      intent: WriteIntent.MODIFY,
      operation: operation(),
      activeClaims: [],
      activeGates: [],
    });

    expect(decision.permitted).toBe(true);
    expect(decision.reason).toBe(WriteDecisionReason.APPROVED_OPERATION);
  });

  it("fails closed when constraint runtime is unavailable", () => {
    const decision = evaluateWriteDecision({
      actorId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      resources: [resource("src/auth.js")],
      intent: WriteIntent.MODIFY,
      activeClaims: [claim({ id: "claim-a", actorId: "agent-a", locator: "src/auth.js" })],
      activeGates: [],
      constraintDecision: { permitted: false, runtimeUnavailable: { message: "projection failed" } },
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers.map(blocker => blocker.id)).toContain("runtime_unavailable");
  });
});
