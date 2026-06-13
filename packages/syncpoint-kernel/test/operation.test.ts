import { describe, it, expect } from "vitest";
import {
  OperationStatus,
  validateOperationTransition,
  OperationSchema,
  OperationCreateSchema,
} from "../src/operation.js";

// ── Operation status machine ─────────────────────────────

describe("Operation transitions", () => {
  const allStatuses = Object.values(OperationStatus);

  it("all statuses are defined", () => {
    expect(allStatuses.length).toBe(7);
    expect(allStatuses).toContain("DRAFT");
    expect(allStatuses).toContain("SUBMITTED");
    expect(allStatuses).toContain("CONFLICTING");
    expect(allStatuses).toContain("APPROVED");
    expect(allStatuses).toContain("REJECTED");
    expect(allStatuses).toContain("APPLIED");
    expect(allStatuses).toContain("CANCELLED");
  });

  describe("DRAFT transitions", () => {
    it("DRAFT → SUBMITTED is valid", () => {
      expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.SUBMITTED)).toBe(true);
    });

    it("DRAFT → CANCELLED is valid", () => {
      expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.CANCELLED)).toBe(true);
    });

    it("DRAFT → APPLIED is invalid", () => {
      expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.APPLIED)).toBe(false);
    });

    it("DRAFT → APPROVED is invalid", () => {
      expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.APPROVED)).toBe(false);
    });
  });

  describe("SUBMITTED transitions", () => {
    const valid = [OperationStatus.APPROVED, OperationStatus.REJECTED, OperationStatus.CONFLICTING, OperationStatus.CANCELLED];
    for (const target of valid) {
      it(`SUBMITTED → ${target} is valid`, () => {
        expect(validateOperationTransition(OperationStatus.SUBMITTED, target)).toBe(true);
      });
    }

    it("SUBMITTED → DRAFT is invalid", () => {
      expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.DRAFT)).toBe(false);
    });
  });

  describe("CONFLICTING transitions", () => {
    it("CONFLICTING → SUBMITTED is valid (retry)", () => {
      expect(validateOperationTransition(OperationStatus.CONFLICTING, OperationStatus.SUBMITTED)).toBe(true);
    });

    it("CONFLICTING → CANCELLED is valid", () => {
      expect(validateOperationTransition(OperationStatus.CONFLICTING, OperationStatus.CANCELLED)).toBe(true);
    });

    it("CONFLICTING → APPROVED is invalid", () => {
      expect(validateOperationTransition(OperationStatus.CONFLICTING, OperationStatus.APPROVED)).toBe(false);
    });
  });

  describe("APPROVED transitions", () => {
    it("APPROVED → APPLIED is valid", () => {
      expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.APPLIED)).toBe(true);
    });

    it("APPROVED → CANCELLED is valid", () => {
      expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.CANCELLED)).toBe(true);
    });

    it("APPROVED → DRAFT is invalid", () => {
      expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.DRAFT)).toBe(false);
    });
  });

  describe("REJECTED transitions", () => {
    it("REJECTED → SUBMITTED is valid (resubmit)", () => {
      expect(validateOperationTransition(OperationStatus.REJECTED, OperationStatus.SUBMITTED)).toBe(true);
    });

    it("REJECTED → CANCELLED is valid", () => {
      expect(validateOperationTransition(OperationStatus.REJECTED, OperationStatus.CANCELLED)).toBe(true);
    });
  });

  describe("terminal states", () => {
    it("APPLIED has no valid transitions", () => {
      for (const target of allStatuses) {
        expect(validateOperationTransition(OperationStatus.APPLIED, target)).toBe(false);
      }
    });

    it("CANCELLED has no valid transitions", () => {
      for (const target of allStatuses) {
        expect(validateOperationTransition(OperationStatus.CANCELLED, target)).toBe(false);
      }
    });
  });

  // ── Full path walk-through ──────────────────────────────

  it("happy path: DRAFT → SUBMITTED → APPROVED → APPLIED", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.SUBMITTED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.APPROVED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.APPLIED)).toBe(true);
  });

  it("conflict path: DRAFT → SUBMITTED → CONFLICTING → SUBMITTED → APPROVED → APPLIED", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.SUBMITTED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.CONFLICTING)).toBe(true);
    expect(validateOperationTransition(OperationStatus.CONFLICTING, OperationStatus.SUBMITTED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.APPROVED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.APPLIED)).toBe(true);
  });

  it("rejection path: DRAFT → SUBMITTED → REJECTED → SUBMITTED → APPROVED → APPLIED", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.SUBMITTED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.REJECTED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.REJECTED, OperationStatus.SUBMITTED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.APPROVED)).toBe(true);
    expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.APPLIED)).toBe(true);
  });
});

// ── Schema validation ────────────────────────────────────

describe("OperationCreateSchema", () => {
  it("accepts valid minimal input", () => {
    const result = OperationCreateSchema.safeParse({
      type: "code_patch",
      actorId: "agent-1",
      taskId: "task-1",
      title: "Fix bug",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty type", () => {
    const result = OperationCreateSchema.safeParse({
      type: "",
      actorId: "agent-1",
      taskId: "task-1",
      title: "Fix bug",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = OperationCreateSchema.safeParse({
      type: "code_patch",
      actorId: "agent-1",
      taskId: "task-1",
      title: "",
    });
    expect(result.success).toBe(false);
  });

  it("defaults summary to empty string", () => {
    const result = OperationCreateSchema.parse({
      type: "code_patch",
      actorId: "agent-1",
      taskId: "task-1",
      title: "Fix bug",
    });
    expect(result.summary).toBe("");
  });

  it("defaults targetResources to empty array", () => {
    const result = OperationCreateSchema.parse({
      type: "code_patch",
      actorId: "agent-1",
      taskId: "task-1",
      title: "Fix bug",
    });
    expect(result.targetResources).toEqual([]);
  });
});
