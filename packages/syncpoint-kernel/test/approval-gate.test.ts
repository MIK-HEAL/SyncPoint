import { describe, it, expect } from "vitest";
import { ApprovalGateStatus } from "../src/approval-gate.js";

describe("ApprovalGateStatus", () => {
  it("has four statuses", () => {
    const values = Object.values(ApprovalGateStatus);
    expect(values).toHaveLength(4);
  });

  it("includes PENDING", () => {
    expect(ApprovalGateStatus.PENDING).toBe("PENDING");
  });

  it("includes PASSED", () => {
    expect(ApprovalGateStatus.PASSED).toBe("PASSED");
  });

  it("includes BLOCKED", () => {
    expect(ApprovalGateStatus.BLOCKED).toBe("BLOCKED");
  });

  it("includes WAIVED", () => {
    expect(ApprovalGateStatus.WAIVED).toBe("WAIVED");
  });
});
