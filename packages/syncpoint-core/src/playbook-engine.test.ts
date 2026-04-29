/**
 * Tests for Playbook Engine — pure next-action computation.
 */

import { describe, it, expect } from "vitest";
import { computeNextActions } from "./playbook-engine.js";
import type { SessionSnapshot } from "./playbook-engine.js";
import { SessionStatus, TaskAssignmentStatus, ReviewRequestStatus } from "./orchestration.js";
import { ApprovalGateStatus } from "./review-workflow.js";
import type { ApprovalGateResult } from "./review-workflow.js";
import { RelationshipMode } from "./relationship-mode.js";

function makeSnap(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: "sess-1",
    sessionStatus: SessionStatus.PLANNING,
    agentId: "agent-1",
    agentRoles: ["architect"],
    assignments: [],
    reviews: [],
    gates: {},
    openChanges: {},
    ...overrides,
  };
}

function makeGate(status: ApprovalGateStatus, reasons: string[] = []): ApprovalGateResult {
  return {
    status,
    reasons,
    checklistTotal: 1,
    checklistPassed: status === ApprovalGateStatus.PASSED ? 1 : 0,
    checklistFailed: 0,
    checklistWaived: 0,
    checklistOpen: status === ApprovalGateStatus.PASSED ? 0 : 1,
    evidenceCount: status === ApprovalGateStatus.PASSED ? 1 : 0,
    openChangeRequests: 0,
  };
}

// ── Terminal states ──

describe("terminal states", () => {
  it("COMPLETED session returns session-completed", () => {
    const actions = computeNextActions(makeSnap({ sessionStatus: SessionStatus.COMPLETED }));
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("session-completed");
  });

  it("CANCELLED session returns no-action", () => {
    const actions = computeNextActions(makeSnap({ sessionStatus: SessionStatus.CANCELLED }));
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("no-action");
  });
});

// ── PLANNING phase ──

describe("PLANNING phase", () => {
  it("architect with no assignments → plan-tasks", () => {
    const actions = computeNextActions(makeSnap());
    expect(actions[0].action).toBe("plan-tasks");
  });

  it("architect with assignments → advance-session", () => {
    const actions = computeNextActions(makeSnap({
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-2", status: TaskAssignmentStatus.PROPOSED }],
    }));
    expect(actions[0].action).toBe("advance-session");
  });

  it("non-architect in PLANNING → wait", () => {
    const actions = computeNextActions(makeSnap({ agentRoles: ["executor"] }));
    expect(actions[0].action).toBe("wait");
  });
});

// ── EXECUTING phase ──

describe("EXECUTING phase", () => {
  it("executor with PROPOSED assignment → accept-assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.PROPOSED }],
    }));
    expect(actions[0].action).toBe("accept-assignment");
  });

  it("executor with ACCEPTED assignment → start-work", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.ACCEPTED }],
    }));
    expect(actions[0].action).toBe("start-work");
  });

  it("executor with IN_PROGRESS assignment → checkpoint or complete", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("checkpoint");
    expect(kinds).toContain("complete-assignment");
  });

  it("executor with open changes → address-changes", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-2", status: ReviewRequestStatus.DECIDED }],
      openChanges: { "rr-1": 2 },
    }));
    expect(actions[0].action).toBe("address-changes");
  });

  it("architect with all tasks completed → request-review", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["architect"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-2", status: TaskAssignmentStatus.COMPLETED }],
    }));
    expect(actions[0].action).toBe("request-review");
  });

  it("architect with reviews already requested → advance-session", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["architect"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-2", status: TaskAssignmentStatus.COMPLETED }],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-3", status: ReviewRequestStatus.PENDING }],
    }));
    expect(actions[0].action).toBe("advance-session");
  });
});

// ── REVIEWING phase ──

describe("REVIEWING phase", () => {
  it("reviewer with PENDING review → start-review", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.REVIEWING,
      agentRoles: ["reviewer"],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-1", status: ReviewRequestStatus.PENDING }],
    }));
    expect(actions[0].action).toBe("start-review");
  });

  it("reviewer with IN_PROGRESS review and no gate → add-checklist + add-evidence", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.REVIEWING,
      agentRoles: ["reviewer"],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-1", status: ReviewRequestStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("add-checklist");
    expect(kinds).toContain("add-evidence");
  });

  it("reviewer with PASSED gate → approve-review", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.REVIEWING,
      agentRoles: ["reviewer"],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-1", status: ReviewRequestStatus.IN_PROGRESS }],
      gates: { "rr-1": makeGate(ApprovalGateStatus.PASSED) },
    }));
    expect(actions[0].action).toBe("approve-review");
  });

  it("reviewer with BLOCKED gate → add-checklist + add-evidence + block-review", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.REVIEWING,
      agentRoles: ["reviewer"],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-1", status: ReviewRequestStatus.IN_PROGRESS }],
      gates: { "rr-1": makeGate(ApprovalGateStatus.BLOCKED, ["No evidence"]) },
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("add-checklist");
    expect(kinds).toContain("add-evidence");
    expect(kinds).toContain("block-review");
  });

  it("architect with all reviews decided → advance-session", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.REVIEWING,
      agentRoles: ["architect"],
      reviews: [{ id: "rr-1", taskId: "t-1", reviewerAgentId: "agent-2", status: ReviewRequestStatus.DECIDED }],
    }));
    expect(actions[0].action).toBe("advance-session");
  });
});

// ── Multi-role agent ──

describe("multi-role agent", () => {
  it("architect+executor in EXECUTING with proposed assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["architect", "executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.PROPOSED }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("accept-assignment");
  });
});

// ── No relevant actions ──

describe("no relevant actions", () => {
  it("executor in REVIEWING with no reviews → wait", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.REVIEWING,
      agentRoles: ["executor"],
    }));
    expect(actions[0].action).toBe("wait");
  });
});

// ── Priority ordering ──

describe("priority ordering", () => {
  it("actions are sorted by priority ascending", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].priority).toBeGreaterThanOrEqual(actions[i - 1].priority);
    }
  });
});

// ── Relationship Mode ──

describe("relationship mode: peer-contract", () => {
  it("suggests claim-files but NOT start-work for ACCEPTED assignment (claim is prerequisite)", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      relationshipMode: RelationshipMode.PEER_CONTRACT,
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.ACCEPTED }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("claim-files");
    expect(kinds).not.toContain("start-work");
  });

  it("suggests sync-checkpoint for IN_PROGRESS assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      relationshipMode: RelationshipMode.PEER_CONTRACT,
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("sync-checkpoint");
  });

  it("does NOT suggest handoff for IN_PROGRESS assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      relationshipMode: RelationshipMode.PEER_CONTRACT,
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).not.toContain("handoff");
  });
});

describe("relationship mode: handoff-resume", () => {
  it("suggests handoff for IN_PROGRESS assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      relationshipMode: RelationshipMode.HANDOFF_RESUME,
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("handoff");
  });

  it("does NOT suggest claim-files for ACCEPTED assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      relationshipMode: RelationshipMode.HANDOFF_RESUME,
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.ACCEPTED }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).not.toContain("claim-files");
  });

  it("does NOT suggest sync-checkpoint for IN_PROGRESS assignment", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      relationshipMode: RelationshipMode.HANDOFF_RESUME,
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).not.toContain("sync-checkpoint");
  });
});

describe("relationship mode: manager-delegate (default)", () => {
  it("does NOT suggest claim-files, sync-checkpoint, or handoff", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).not.toContain("claim-files");
    expect(kinds).not.toContain("sync-checkpoint");
    expect(kinds).not.toContain("handoff");
  });

  it("suggests checkpoint and complete-assignment for IN_PROGRESS", () => {
    const actions = computeNextActions(makeSnap({
      sessionStatus: SessionStatus.EXECUTING,
      agentRoles: ["executor"],
      assignments: [{ id: "ta-1", taskId: "t-1", assigneeAgentId: "agent-1", status: TaskAssignmentStatus.IN_PROGRESS }],
    }));
    const kinds = actions.map(a => a.action);
    expect(kinds).toContain("checkpoint");
    expect(kinds).toContain("complete-assignment");
  });
});
