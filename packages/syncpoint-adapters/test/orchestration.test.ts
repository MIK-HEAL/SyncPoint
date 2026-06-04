/**
 * Tests for orchestration.ts — types, enums, state transitions.
 */

import { describe, it, expect } from "vitest";
import {
  OrchestratorRole,
  SessionStatus,
  ReviewVerdict,
  TaskAssignmentStatus,
  ReviewRequestStatus,
  SESSION_TRANSITIONS,
  TASK_ASSIGNMENT_TRANSITIONS,
  REVIEW_REQUEST_TRANSITIONS,
  validateSessionTransition,
  validateTaskAssignmentTransition,
  validateReviewRequestTransition,
  OrchestrationSessionCreateSchema,
  RoleProfileCreateSchema,
  TaskAssignmentCreateSchema,
  ReviewRequestCreateSchema,
  ReviewDecisionCreateSchema,
} from "../src/orchestration.js";
import { InvalidTransition } from "../src/states.js";

describe("OrchestratorRole", () => {
  it("should have 4 roles", () => {
    expect(OrchestratorRole.options).toEqual(["architect", "executor", "reviewer", "owner"]);
  });
});

describe("ReviewVerdict", () => {
  it("should have 3 verdicts", () => {
    expect(ReviewVerdict.options).toEqual(["approved", "request-changes", "rejected"]);
  });
});

describe("SessionStatus transitions", () => {
  it("PLANNING → EXECUTING", () => {
    expect(() => validateSessionTransition(SessionStatus.PLANNING, SessionStatus.EXECUTING)).not.toThrow();
  });

  it("PLANNING → CANCELLED", () => {
    expect(() => validateSessionTransition(SessionStatus.PLANNING, SessionStatus.CANCELLED)).not.toThrow();
  });

  it("PLANNING → COMPLETED is invalid", () => {
    expect(() => validateSessionTransition(SessionStatus.PLANNING, SessionStatus.COMPLETED)).toThrow(InvalidTransition);
  });

  it("EXECUTING → REVIEWING", () => {
    expect(() => validateSessionTransition(SessionStatus.EXECUTING, SessionStatus.REVIEWING)).not.toThrow();
  });

  it("EXECUTING → PLANNING (rework)", () => {
    expect(() => validateSessionTransition(SessionStatus.EXECUTING, SessionStatus.PLANNING)).not.toThrow();
  });

  it("REVIEWING → COMPLETED", () => {
    expect(() => validateSessionTransition(SessionStatus.REVIEWING, SessionStatus.COMPLETED)).not.toThrow();
  });

  it("REVIEWING → EXECUTING (request-changes)", () => {
    expect(() => validateSessionTransition(SessionStatus.REVIEWING, SessionStatus.EXECUTING)).not.toThrow();
  });

  it("COMPLETED has no outgoing transitions", () => {
    expect(SESSION_TRANSITIONS[SessionStatus.COMPLETED]).toEqual([]);
  });

  it("CANCELLED has no outgoing transitions", () => {
    expect(SESSION_TRANSITIONS[SessionStatus.CANCELLED]).toEqual([]);
  });

  it("every allowed transition passes validation", () => {
    for (const [from, targets] of Object.entries(SESSION_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateSessionTransition(from as SessionStatus, to)).not.toThrow();
      }
    }
  });
});

describe("TaskAssignment transitions", () => {
  it("PROPOSED → ACCEPTED", () => {
    expect(() => validateTaskAssignmentTransition(TaskAssignmentStatus.PROPOSED, TaskAssignmentStatus.ACCEPTED)).not.toThrow();
  });

  it("PROPOSED → CANCELLED", () => {
    expect(() => validateTaskAssignmentTransition(TaskAssignmentStatus.PROPOSED, TaskAssignmentStatus.CANCELLED)).not.toThrow();
  });

  it("PROPOSED → IN_PROGRESS is invalid", () => {
    expect(() => validateTaskAssignmentTransition(TaskAssignmentStatus.PROPOSED, TaskAssignmentStatus.IN_PROGRESS)).toThrow(InvalidTransition);
  });

  it("ACCEPTED → IN_PROGRESS", () => {
    expect(() => validateTaskAssignmentTransition(TaskAssignmentStatus.ACCEPTED, TaskAssignmentStatus.IN_PROGRESS)).not.toThrow();
  });

  it("IN_PROGRESS → COMPLETED", () => {
    expect(() => validateTaskAssignmentTransition(TaskAssignmentStatus.IN_PROGRESS, TaskAssignmentStatus.COMPLETED)).not.toThrow();
  });

  it("COMPLETED has no outgoing transitions", () => {
    expect(TASK_ASSIGNMENT_TRANSITIONS[TaskAssignmentStatus.COMPLETED]).toEqual([]);
  });

  it("every allowed transition passes validation", () => {
    for (const [from, targets] of Object.entries(TASK_ASSIGNMENT_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateTaskAssignmentTransition(from as TaskAssignmentStatus, to)).not.toThrow();
      }
    }
  });
});

describe("ReviewRequest transitions", () => {
  it("PENDING → IN_PROGRESS", () => {
    expect(() => validateReviewRequestTransition(ReviewRequestStatus.PENDING, ReviewRequestStatus.IN_PROGRESS)).not.toThrow();
  });

  it("IN_PROGRESS → DECIDED", () => {
    expect(() => validateReviewRequestTransition(ReviewRequestStatus.IN_PROGRESS, ReviewRequestStatus.DECIDED)).not.toThrow();
  });

  it("PENDING → DECIDED is invalid", () => {
    expect(() => validateReviewRequestTransition(ReviewRequestStatus.PENDING, ReviewRequestStatus.DECIDED)).toThrow(InvalidTransition);
  });

  it("DECIDED has no outgoing transitions", () => {
    expect(REVIEW_REQUEST_TRANSITIONS[ReviewRequestStatus.DECIDED]).toEqual([]);
  });

  it("every allowed transition passes validation", () => {
    for (const [from, targets] of Object.entries(REVIEW_REQUEST_TRANSITIONS)) {
      for (const to of targets) {
        expect(() => validateReviewRequestTransition(from as ReviewRequestStatus, to)).not.toThrow();
      }
    }
  });
});

describe("Zod schemas parse correctly", () => {
  it("OrchestrationSessionCreateSchema", () => {
    const result = OrchestrationSessionCreateSchema.parse({ title: "Sprint 1" });
    expect(result.title).toBe("Sprint 1");
    expect(result.description).toBe("");
  });

  it("RoleProfileCreateSchema", () => {
    const result = RoleProfileCreateSchema.parse({ sessionId: "s1", agentId: "a1", role: "architect" });
    expect(result.role).toBe("architect");
  });

  it("TaskAssignmentCreateSchema", () => {
    const result = TaskAssignmentCreateSchema.parse({ sessionId: "s1", taskId: "t1", assigneeAgentId: "a2" });
    expect(result.assigneeAgentId).toBe("a2");
  });

  it("ReviewRequestCreateSchema", () => {
    const result = ReviewRequestCreateSchema.parse({ sessionId: "s1", taskId: "t1", reviewerAgentId: "a3" });
    expect(result.reviewerAgentId).toBe("a3");
  });

  it("ReviewDecisionCreateSchema", () => {
    const result = ReviewDecisionCreateSchema.parse({
      reviewRequestId: "rr1", verdict: "approved", summary: "Looks good",
    });
    expect(result.verdict).toBe("approved");
    expect(result.requestedChanges).toBe("");
  });

  it("OrchestratorRole rejects unknown role", () => {
    expect(() => OrchestratorRole.parse("unknown")).toThrow();
  });

  it("ReviewVerdict rejects unknown verdict", () => {
    expect(() => ReviewVerdict.parse("maybe")).toThrow();
  });
});
