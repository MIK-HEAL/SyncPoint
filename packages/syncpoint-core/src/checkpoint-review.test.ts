/**
 * Unit tests for CheckpointReview — status transitions, approval logic.
 */

import { describe, it, expect } from "vitest";
import {
  CheckpointReviewStatus,
  CHECKPOINT_REVIEW_TRANSITIONS,
  validateCheckpointReviewTransition,
  parseIdListCsv,
  allApproved,
  hasRejection,
  pendingApprovers,
  isReviewTerminal,
  isReviewBlocking,
} from "./checkpoint-review.js";
import type { CheckpointReview } from "./checkpoint-review.js";

function makeReview(overrides: Partial<CheckpointReview> = {}): CheckpointReview {
  return {
    id: "tx1",
    sessionId: "s1",
    taskId: "t1",
    checkpointId: "cp1",
    requestingAgentId: "a1",
    requiredApproverIds: "a2,a3",
    approvedByIds: "",
    rejectedByIds: "",
    gateId: "g1",
    status: CheckpointReviewStatus.WAITING_APPROVAL,
    decisionSummary: "",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

// ── transitions ─────────────────────────────────────

describe("CheckpointReview transitions", () => {
  it("OPEN → WAITING_APPROVAL is valid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.OPEN, CheckpointReviewStatus.WAITING_APPROVAL)).toBe(true);
  });

  it("WAITING_APPROVAL → APPROVED is valid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.WAITING_APPROVAL, CheckpointReviewStatus.APPROVED)).toBe(true);
  });

  it("WAITING_APPROVAL → REJECTED is valid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.WAITING_APPROVAL, CheckpointReviewStatus.REJECTED)).toBe(true);
  });

  it("APPROVED → RESOLVED is valid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.APPROVED, CheckpointReviewStatus.RESOLVED)).toBe(true);
  });

  it("REJECTED → RESOLVED is valid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.REJECTED, CheckpointReviewStatus.RESOLVED)).toBe(true);
  });

  it("RESOLVED is terminal", () => {
    expect(CHECKPOINT_REVIEW_TRANSITIONS[CheckpointReviewStatus.RESOLVED]).toHaveLength(0);
  });

  it("CANCELLED is terminal", () => {
    expect(CHECKPOINT_REVIEW_TRANSITIONS[CheckpointReviewStatus.CANCELLED]).toHaveLength(0);
  });

  it("any non-terminal → CANCELLED is valid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.OPEN, CheckpointReviewStatus.CANCELLED)).toBe(true);
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.WAITING_APPROVAL, CheckpointReviewStatus.CANCELLED)).toBe(true);
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.APPROVED, CheckpointReviewStatus.CANCELLED)).toBe(true);
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.REJECTED, CheckpointReviewStatus.CANCELLED)).toBe(true);
  });

  it("backward transitions are invalid", () => {
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.APPROVED, CheckpointReviewStatus.OPEN)).toBe(false);
    expect(validateCheckpointReviewTransition(CheckpointReviewStatus.RESOLVED, CheckpointReviewStatus.WAITING_APPROVAL)).toBe(false);
  });
});

// ── parseIdListCsv ───────────────────────────────────

describe("parseIdListCsv", () => {
  it("splits comma-separated IDs", () => {
    expect(parseIdListCsv("a1,a2,a3")).toEqual(["a1", "a2", "a3"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseIdListCsv("")).toEqual([]);
  });
});

// ── allApproved ─────────────────────────────────────

describe("allApproved", () => {
  it("false when no approvals", () => {
    expect(allApproved(makeReview())).toBe(false);
  });

  it("false when partial approval", () => {
    expect(allApproved(makeReview({ approvedByIds: "a2" }))).toBe(false);
  });

  it("true when all required approved", () => {
    expect(allApproved(makeReview({ approvedByIds: "a2,a3" }))).toBe(true);
  });
});

// ── hasRejection ────────────────────────────────────

describe("hasRejection", () => {
  it("false when no rejections", () => {
    expect(hasRejection(makeReview())).toBe(false);
  });

  it("true when any rejection", () => {
    expect(hasRejection(makeReview({ rejectedByIds: "a2" }))).toBe(true);
  });
});

// ── pendingApprovers ────────────────────────────────

describe("pendingApprovers", () => {
  it("returns all when none decided", () => {
    expect(pendingApprovers(makeReview())).toEqual(["a2", "a3"]);
  });

  it("returns remaining after partial decision", () => {
    expect(pendingApprovers(makeReview({ approvedByIds: "a2" }))).toEqual(["a3"]);
  });

  it("accounts for both approvals and rejections", () => {
    expect(pendingApprovers(makeReview({ approvedByIds: "a2", rejectedByIds: "a3" }))).toEqual([]);
  });
});

// ── isReviewTerminal / isReviewBlocking ─────────────────────

describe("isReviewTerminal", () => {
  it("RESOLVED is terminal", () => {
    expect(isReviewTerminal(CheckpointReviewStatus.RESOLVED)).toBe(true);
  });

  it("CANCELLED is terminal", () => {
    expect(isReviewTerminal(CheckpointReviewStatus.CANCELLED)).toBe(true);
  });

  it("WAITING_APPROVAL is not terminal", () => {
    expect(isReviewTerminal(CheckpointReviewStatus.WAITING_APPROVAL)).toBe(false);
  });
});

describe("isReviewBlocking", () => {
  it("OPEN blocks", () => {
    expect(isReviewBlocking(CheckpointReviewStatus.OPEN)).toBe(true);
  });

  it("WAITING_APPROVAL blocks", () => {
    expect(isReviewBlocking(CheckpointReviewStatus.WAITING_APPROVAL)).toBe(true);
  });

  it("REJECTED blocks", () => {
    expect(isReviewBlocking(CheckpointReviewStatus.REJECTED)).toBe(true);
  });

  it("APPROVED does not block", () => {
    expect(isReviewBlocking(CheckpointReviewStatus.APPROVED)).toBe(false);
  });

  it("RESOLVED does not block", () => {
    expect(isReviewBlocking(CheckpointReviewStatus.RESOLVED)).toBe(false);
  });

  it("CANCELLED does not block", () => {
    expect(isReviewBlocking(CheckpointReviewStatus.CANCELLED)).toBe(false);
  });
});
