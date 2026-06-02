/**
 * Tests for Wake Engine — pure computeWakeTargets computation.
 */

import { describe, it, expect } from "vitest";
import { computeWakeTargets, DEFAULT_WAKE_RULES, SYNC_VERB_WHITELIST, OrchestrationEventType, validateWakeRequestTransition, WakeRequestStatus } from "./wake.js";
import type { WakeContext, WakeRule } from "./wake.js";
import { RelationshipMode } from "./relationship-mode.js";

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
    expect(targets[0]!.targetRole).toBe("architect");
    expect(targets[0]!.action).toBe("plan-tasks");
  });

  it("ASSIGNMENT_COMPLETED wakes architect to request-review", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.ASSIGNMENT_COMPLETED,
      sessionStatus: "EXECUTING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetRole).toBe("architect");
    expect(targets[0]!.action).toBe("request-review");
  });

  it("REVIEW_REQUESTED wakes reviewer to start-review", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
      sessionStatus: "REVIEWING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetRole).toBe("reviewer");
    expect(targets[0]!.action).toBe("start-review");
  });

  it("REVIEW_APPROVED wakes architect to advance-session", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_APPROVED,
      sessionStatus: "REVIEWING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetRole).toBe("architect");
    expect(targets[0]!.action).toBe("advance-session");
  });

  it("REVIEW_BLOCKED wakes executor to address-changes", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_BLOCKED,
      sessionStatus: "EXECUTING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetRole).toBe("executor");
    expect(targets[0]!.action).toBe("address-changes");
  });

  it("SESSION_ADVANCED to EXECUTING wakes executor to accept-assignment", () => {
    const targets = computeWakeTargets(makeCtx({
      triggerEventType: OrchestrationEventType.SESSION_ADVANCED,
      sessionStatus: "EXECUTING",
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetRole).toBe("executor");
    expect(targets[0]!.action).toBe("accept-assignment");
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

  it("all default wake rule actions are in SYNC_VERB_WHITELIST", () => {
    for (const rule of DEFAULT_WAKE_RULES) {
      expect(SYNC_VERB_WHITELIST).toContain(rule.action);
    }
  });
});

// ── P4: Sync verb enforcement ──

describe("SYNC_VERB_WHITELIST", () => {
  it("blocks non-sync verbs (e.g. start-work, complete-assignment)", () => {
    expect(SYNC_VERB_WHITELIST).not.toContain("start-work");
    expect(SYNC_VERB_WHITELIST).not.toContain("complete-assignment");
  });

  it("allows sync-semantic verbs", () => {
    expect(SYNC_VERB_WHITELIST).toContain("plan-tasks");
    expect(SYNC_VERB_WHITELIST).toContain("accept-assignment");
    expect(SYNC_VERB_WHITELIST).toContain("request-review");
    expect(SYNC_VERB_WHITELIST).toContain("advance-session");
    expect(SYNC_VERB_WHITELIST).toContain("claim-resources");
    expect(SYNC_VERB_WHITELIST).toContain("sync-checkpoint");
  });
});

describe("computeWakeTargets rejects non-sync verbs", () => {
  it("custom rule with start-work action is filtered out", () => {
    const customRules: WakeRule[] = [
      {
        trigger: OrchestrationEventType.SESSION_ADVANCED,
        targetRole: "executor",
        action: "start-work" as any,
        reason: "Auto-start work",
        priority: 1,
        sessionStatus: "EXECUTING",
      },
    ];
    const targets = computeWakeTargets(
      makeCtx({ triggerEventType: OrchestrationEventType.SESSION_ADVANCED, sessionStatus: "EXECUTING" }),
      customRules,
    );
    expect(targets).toHaveLength(0);
  });
});

describe("computeWakeTargets with relationshipMode", () => {
  it("handoff-resume mode blocks review wake", () => {
    const targets = computeWakeTargets(
      makeCtx({
        triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
        sessionStatus: "REVIEWING",
        relationshipMode: RelationshipMode.HANDOFF_RESUME,
      }),
    );
    expect(targets).toHaveLength(0);
  });

  it("handoff-resume mode blocks address-changes wake", () => {
    const targets = computeWakeTargets(
      makeCtx({
        triggerEventType: OrchestrationEventType.REVIEW_BLOCKED,
        sessionStatus: "EXECUTING",
        relationshipMode: RelationshipMode.HANDOFF_RESUME,
      }),
    );
    expect(targets).toHaveLength(0);
  });

  it("manager-delegate mode allows review wake", () => {
    const targets = computeWakeTargets(
      makeCtx({
        triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
        sessionStatus: "REVIEWING",
        relationshipMode: RelationshipMode.MANAGER_DELEGATE,
      }),
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]!.action).toBe("start-review");
  });

  it("manager-delegate mode blocks custom sync-checkpoint rule", () => {
    const customRules: WakeRule[] = [
      {
        trigger: OrchestrationEventType.ASSIGNMENT_STARTED,
        targetRole: "executor",
        action: "sync-checkpoint" as any,
        reason: "Sync after start",
        priority: 1,
      },
    ];
    const targets = computeWakeTargets(
      makeCtx({
        triggerEventType: OrchestrationEventType.ASSIGNMENT_STARTED,
        sessionStatus: "EXECUTING",
        relationshipMode: RelationshipMode.MANAGER_DELEGATE,
      }),
      customRules,
    );
    expect(targets).toHaveLength(0);
  });

  it("peer-contract mode allows review wake", () => {
    const targets = computeWakeTargets(
      makeCtx({
        triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
        sessionStatus: "REVIEWING",
        relationshipMode: RelationshipMode.PEER_CONTRACT,
      }),
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]!.action).toBe("start-review");
  });

  it("peer-contract mode allows claim-resources custom rule", () => {
    const customRules: WakeRule[] = [
      {
        trigger: OrchestrationEventType.ASSIGNMENT_ACCEPTED,
        targetRole: "executor",
        action: "claim-resources" as any,
        reason: "Claim files after accepting",
        priority: 1,
      },
    ];
    const targets = computeWakeTargets(
      makeCtx({
        triggerEventType: OrchestrationEventType.ASSIGNMENT_ACCEPTED,
        sessionStatus: "EXECUTING",
        relationshipMode: RelationshipMode.PEER_CONTRACT,
      }),
      customRules,
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(targets[0]!.action).toBe("claim-resources");
  });

  it("without mode, all default rules apply", () => {
    const targets = computeWakeTargets(makeCtx());
    expect(targets.length).toBeGreaterThan(0);
  });

  it("all three modes produce different results for REVIEW_REQUESTED", () => {
    const ctx = (mode: RelationshipMode) => makeCtx({
      triggerEventType: OrchestrationEventType.REVIEW_REQUESTED,
      sessionStatus: "REVIEWING",
      relationshipMode: mode,
    });
    const md = computeWakeTargets(ctx(RelationshipMode.MANAGER_DELEGATE));
    const pc = computeWakeTargets(ctx(RelationshipMode.PEER_CONTRACT));
    const hr = computeWakeTargets(ctx(RelationshipMode.HANDOFF_RESUME));

    expect(md.length).toBeGreaterThan(0);
    expect(pc.length).toBeGreaterThan(0);
    expect(hr).toHaveLength(0);
  });
});
