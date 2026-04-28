/**
 * Tests for Wake Engine — pure computeWakeTargets computation.
 */

import { describe, it, expect } from "vitest";
import { computeWakeTargets, DEFAULT_WAKE_RULES, OrchestrationEventType, validateWakeRequestTransition, WakeRequestStatus } from "./wake.js";
import type { WakeContext } from "./wake.js";

function makeCtx(overrides: Partial<WakeContext> = {}): WakeContext {
  return {
    triggerEventType: OrchestrationEventType.SESSION_CREATED,
    sessionId: "sess-1",
    sessionStatus: "PLANNING",
    roleBindings: [
      { agentId: "arch-1", role: "architect" },
      { agentId: "exec-1", role: "executor" },
      { agentId: "rev-1", role: "reviewer" },
    ],
    ...overrides,
  };
}

describe("computeWakeTargets", () => {
  it("SESSION_CREATED wakes architect to plan-tasks", () => {
    const targets = computeWakeTargets(makeCtx());
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRole).toBe("architect");
    expect(targets[0].action).toBe("plan-tasks");
  });

  it("ASSIGNMENT_COMPLETED wakes architect to request-review", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.ASSIGNMENT_COMPLETED,
      sessionStatus: "EXECUTING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRole).toBe("architect");
    expect(targets[0].action).toBe("request-review");
  });

  it("REVIEW_REQUESTED wakes reviewer to start-review", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
      sessionStatus: "REVIEWING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRole).toBe("reviewer");
    expect(targets[0].action).toBe("start-review");
  });

  it("REVIEW_APPROVED wakes architect to advance-session", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_APPROVED,
      sessionStatus: "REVIEWING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRole).toBe("architect");
    expect(targets[0].action).toBe("advance-session");
  });

  it("REVIEW_BLOCKED wakes executor to address-changes", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_BLOCKED,
      sessionStatus: "EXECUTING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRole).toBe("executor");
    expect(targets[0].action).toBe("address-changes");
  });

  it("SESSION_ADVANCED to EXECUTING wakes executor to accept-assignment", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.SESSION_ADVANCED,
      sessionStatus: "EXECUTING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0].targetRole).toBe("executor");
    expect(targets[0].action).toBe("accept-assignment");
  });

  it("SESSION_ADVANCED to REVIEWING does NOT wake executor", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.SESSION_ADVANCED,
      sessionStatus: "REVIEWING",
    }));
    expect(targets).toHaveLength(0);
  });

  it("returns empty array for unrecognized event", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: "UNKNOWN_EVENT",
    }));
    expect(targets).toHaveLength(0);
  });

  it("skips if target role is not in the session", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
      sessionStatus: "REVIEWING",
      roleBindings: [
        { agentId: "arch-1", role: "architect" },
        { agentId: "exec-1", role: "executor" },
        // no reviewer!
      ],
    }));
    expect(targets).toHaveLength(0);
  });
});

describe("WakeRequest transitions", () => {
  it("QUEUED → DISPATCHED", () => {
    expect(() => validateWakeRequestTransition(WakeRequestStatus.QUEUED, WakeRequestStatus.DISPATCHED)).not.toThrow();
  });

  it("QUEUED → DONE is invalid", () => {
    expect(() => validateWakeRequestTransition(WakeRequestStatus.QUEUED, WakeRequestStatus.DONE)).toThrow();
  });

  it("DISPATCHED → RUNNING", () => {
    expect(() => validateWakeRequestTransition(WakeRequestStatus.DISPATCHED, WakeRequestStatus.RUNNING)).not.toThrow();
  });

  it("RUNNING → DONE", () => {
    expect(() => validateWakeRequestTransition(WakeRequestStatus.RUNNING, WakeRequestStatus.DONE)).not.toThrow();
  });

  it("FAILED → QUEUED (retry)", () => {
    expect(() => validateWakeRequestTransition(WakeRequestStatus.FAILED, WakeRequestStatus.QUEUED)).not.toThrow();
  });

  it("DONE → anything is invalid", () => {
    expect(() => validateWakeRequestTransition(WakeRequestStatus.DONE, WakeRequestStatus.QUEUED)).toThrow();
  });
});

describe("DEFAULT_WAKE_RULES structure", () => {
  it("has rules for the full happy path", () => {
    const triggers = DEFAULT_WAKE_RULES.map(r => r.trigger);
    expect(triggers).toContain(OrchestrationEventType.SESSION_CREATED);
    expect(triggers).toContain(OrchestrationEventType.ASSIGNMENT_COMPLETED);
    expect(triggers).toContain(OrchestrationEventType.REVIEW_REQUESTED);
    expect(triggers).toContain(OrchestrationEventType.REVIEW_APPROVED);
  });
});
