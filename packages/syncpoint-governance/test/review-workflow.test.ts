/**
 * Tests for review-workflow.ts — enums, schemas, transitions, approval gate.
 */

import { describe, it, expect } from "vitest";
import {
  ChecklistItemStatus,
  validateChecklistItemTransition,
  EvidenceKind,
  ChangeRequestStatus,
  validateChangeRequestTransition,
  ApprovalGateStatus,
  ApprovalRecordDecision,
  ReviewChecklistItemSchema,
  ReviewChecklistItemCreateSchema,
  ReviewEvidenceSchema,
  ReviewEvidenceCreateSchema,
  ChangeRequestSchema,
  ChangeRequestCreateSchema,
  ApprovalRecordSchema,
  ApprovalRecordCreateSchema,
  evaluateApprovalGate,
} from "../src/review-workflow.js";
import type { ReviewChecklistItem } from "../src/review-workflow.js";

// ── Enums ────────────────────────────────────────────

describe("ChecklistItemStatus", () => {
  it("has 4 values", () => {
    expect(Object.values(ChecklistItemStatus)).toEqual(["OPEN", "PASSED", "FAILED", "WAIVED"]);
  });
});

describe("EvidenceKind", () => {
  it("has 9 values", () => {
    expect(EvidenceKind.options).toEqual([
      "build", "typecheck", "test", "lint", "manual", "diff", "log", "screenshot", "note",
    ]);
  });
});

describe("ChangeRequestStatus", () => {
  it("has 4 values", () => {
    expect(Object.values(ChangeRequestStatus)).toEqual(["OPEN", "ADDRESSED", "REJECTED", "CANCELLED"]);
  });
});

describe("ApprovalGateStatus", () => {
  it("has 4 values", () => {
    expect(Object.values(ApprovalGateStatus)).toEqual(["PENDING", "PASSED", "BLOCKED", "WAIVED"]);
  });
});

describe("ApprovalRecordDecision", () => {
  it("has 3 values", () => {
    expect(ApprovalRecordDecision.options).toEqual(["approved", "blocked", "waived"]);
  });
});

// ── Checklist Item Transitions ──────────────────────

describe("validateChecklistItemTransition", () => {
  it("OPEN → PASSED", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.OPEN, ChecklistItemStatus.PASSED)).not.toThrow();
  });

  it("OPEN → FAILED", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.OPEN, ChecklistItemStatus.FAILED)).not.toThrow();
  });

  it("OPEN → WAIVED", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.OPEN, ChecklistItemStatus.WAIVED)).not.toThrow();
  });

  it("PASSED → OPEN (re-open)", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.PASSED, ChecklistItemStatus.OPEN)).not.toThrow();
  });

  it("FAILED → OPEN (re-open)", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.FAILED, ChecklistItemStatus.OPEN)).not.toThrow();
  });

  it("FAILED → WAIVED", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.FAILED, ChecklistItemStatus.WAIVED)).not.toThrow();
  });

  it("WAIVED → OPEN (re-open)", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.WAIVED, ChecklistItemStatus.OPEN)).not.toThrow();
  });

  it("PASSED → FAILED is invalid", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.PASSED, ChecklistItemStatus.FAILED)).toThrow("Invalid ChecklistItem transition");
  });

  it("WAIVED → PASSED is invalid", () => {
    expect(() => validateChecklistItemTransition(ChecklistItemStatus.WAIVED, ChecklistItemStatus.PASSED)).toThrow("Invalid ChecklistItem transition");
  });
});

// ── Change Request Transitions ──────────────────────

describe("validateChangeRequestTransition", () => {
  it("OPEN → ADDRESSED", () => {
    expect(() => validateChangeRequestTransition(ChangeRequestStatus.OPEN, ChangeRequestStatus.ADDRESSED)).not.toThrow();
  });

  it("OPEN → REJECTED", () => {
    expect(() => validateChangeRequestTransition(ChangeRequestStatus.OPEN, ChangeRequestStatus.REJECTED)).not.toThrow();
  });

  it("OPEN → CANCELLED", () => {
    expect(() => validateChangeRequestTransition(ChangeRequestStatus.OPEN, ChangeRequestStatus.CANCELLED)).not.toThrow();
  });

  it("ADDRESSED → OPEN (re-open)", () => {
    expect(() => validateChangeRequestTransition(ChangeRequestStatus.ADDRESSED, ChangeRequestStatus.OPEN)).not.toThrow();
  });

  it("REJECTED → anything is invalid", () => {
    expect(() => validateChangeRequestTransition(ChangeRequestStatus.REJECTED, ChangeRequestStatus.OPEN)).toThrow("Invalid ChangeRequest transition");
  });

  it("CANCELLED → anything is invalid", () => {
    expect(() => validateChangeRequestTransition(ChangeRequestStatus.CANCELLED, ChangeRequestStatus.OPEN)).toThrow("Invalid ChangeRequest transition");
  });
});

// ── Zod Schemas ──────────────────────────────────────

describe("ReviewChecklistItemSchema", () => {
  it("parses valid item", () => {
    const item = ReviewChecklistItemSchema.parse({
      id: "ci-1",
      reviewRequestId: "rr-1",
      title: "Tests pass",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    expect(item.status).toBe(ChecklistItemStatus.OPEN);
    expect(item.required).toBe(true);
    expect(item.description).toBe("");
  });
});

describe("ReviewChecklistItemCreateSchema", () => {
  it("parses minimal create", () => {
    const c = ReviewChecklistItemCreateSchema.parse({
      reviewRequestId: "rr-1",
      title: "Build passes",
    });
    expect(c.required).toBeUndefined();
  });
});

describe("ReviewEvidenceSchema", () => {
  it("parses valid evidence", () => {
    const e = ReviewEvidenceSchema.parse({
      id: "ev-1",
      reviewRequestId: "rr-1",
      kind: "test",
      title: "pnpm test",
      content: "262 tests passed",
      createdAt: "2026-01-01",
    });
    expect(e.kind).toBe("test");
    expect(e.metadataJson).toBe("");
  });
});

describe("ReviewEvidenceCreateSchema", () => {
  it("parses with metadataJson", () => {
    const c = ReviewEvidenceCreateSchema.parse({
      reviewRequestId: "rr-1",
      kind: "build",
      title: "pnpm build",
      content: "6 packages built",
      metadataJson: '{"exitCode":0}',
    });
    expect(c.metadataJson).toBe('{"exitCode":0}');
  });
});

describe("ChangeRequestSchema", () => {
  it("parses valid change request", () => {
    const cr = ChangeRequestSchema.parse({
      id: "cr-1",
      reviewRequestId: "rr-1",
      summary: "Add error handling",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    expect(cr.status).toBe(ChangeRequestStatus.OPEN);
    expect(cr.evidenceId).toBeNull();
  });
});

describe("ApprovalRecordSchema", () => {
  it("parses valid record", () => {
    const ar = ApprovalRecordSchema.parse({
      id: "ar-1",
      reviewRequestId: "rr-1",
      decision: "approved",
      summary: "LGTM",
      createdAt: "2026-01-01",
    });
    expect(ar.decision).toBe("approved");
    expect(ar.waiverReason).toBe("");
  });
});

// ── Approval Gate ────────────────────────────────────

function makeItem(overrides: Partial<ReviewChecklistItem> = {}): ReviewChecklistItem {
  return {
    id: "ci-1",
    reviewRequestId: "rr-1",
    title: "Test",
    description: "",
    required: true,
    status: ChecklistItemStatus.OPEN,
    notes: "",
    updatedBy: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

describe("evaluateApprovalGate", () => {
  it("PASSED when all required items passed and evidence exists", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
      makeItem({ id: "2", status: ChecklistItemStatus.PASSED }),
    ];
    const result = evaluateApprovalGate(items, 2, 0);
    expect(result.status).toBe(ApprovalGateStatus.PASSED);
    expect(result.reasons).toEqual([]);
    expect(result.checklistPassed).toBe(2);
    expect(result.evidenceCount).toBe(2);
  });

  it("PASSED when all required passed/waived", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
      makeItem({ id: "2", status: ChecklistItemStatus.WAIVED }),
    ];
    const result = evaluateApprovalGate(items, 1, 0);
    expect(result.status).toBe(ApprovalGateStatus.PASSED);
  });

  it("PASSED with non-required OPEN items", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
      makeItem({ id: "2", status: ChecklistItemStatus.OPEN, required: false }),
    ];
    const result = evaluateApprovalGate(items, 1, 0);
    expect(result.status).toBe(ApprovalGateStatus.PASSED);
  });

  it("BLOCKED when required items still OPEN", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
      makeItem({ id: "2", status: ChecklistItemStatus.OPEN }),
    ];
    const result = evaluateApprovalGate(items, 1, 0);
    expect(result.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(result.reasons).toContain("1 required checklist item(s) still OPEN");
  });

  it("BLOCKED when no evidence", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
    ];
    const result = evaluateApprovalGate(items, 0, 0);
    expect(result.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(result.reasons).toContain("No review evidence recorded");
  });

  it("BLOCKED when required item FAILED", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.FAILED }),
      makeItem({ id: "2", status: ChecklistItemStatus.PASSED }),
    ];
    const result = evaluateApprovalGate(items, 1, 0);
    expect(result.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(result.reasons).toContain("1 required checklist item(s) FAILED");
  });

  it("BLOCKED when open change requests", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
    ];
    const result = evaluateApprovalGate(items, 1, 2);
    expect(result.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(result.reasons).toContain("2 open change request(s)");
  });

  it("BLOCKED with multiple reasons", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.FAILED }),
    ];
    const result = evaluateApprovalGate(items, 0, 1);
    expect(result.status).toBe(ApprovalGateStatus.BLOCKED);
    expect(result.reasons.length).toBe(3); // FAILED + no evidence + open changes
  });

  it("PASSED with empty checklist but has evidence", () => {
    const result = evaluateApprovalGate([], 1, 0);
    expect(result.status).toBe(ApprovalGateStatus.PASSED);
    expect(result.checklistTotal).toBe(0);
  });

  it("counts correctly", () => {
    const items = [
      makeItem({ id: "1", status: ChecklistItemStatus.PASSED }),
      makeItem({ id: "2", status: ChecklistItemStatus.FAILED }),
      makeItem({ id: "3", status: ChecklistItemStatus.WAIVED }),
      makeItem({ id: "4", status: ChecklistItemStatus.OPEN }),
    ];
    const result = evaluateApprovalGate(items, 3, 0);
    expect(result.checklistTotal).toBe(4);
    expect(result.checklistPassed).toBe(1);
    expect(result.checklistFailed).toBe(1);
    expect(result.checklistWaived).toBe(1);
    expect(result.checklistOpen).toBe(1);
  });
});
