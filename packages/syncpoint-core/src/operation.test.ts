/**
 * Unit tests for Operation — generic operation protocol.
 */

import { describe, it, expect } from "vitest";
import {
  OperationStatus,
  validateOperationTransition,
} from "./operation.js";

// ── Operation transitions ──────────────────────────

describe("Operation status transitions", () => {
  it("DRAFT → SUBMITTED is valid", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.SUBMITTED)).toBe(true);
  });

  it("SUBMITTED → APPROVED is valid", () => {
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.APPROVED)).toBe(true);
  });

  it("SUBMITTED → CONFLICTING is valid", () => {
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.CONFLICTING)).toBe(true);
  });

  it("APPROVED → APPLIED is valid", () => {
    expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.APPLIED)).toBe(true);
  });

  it("APPLIED → anything is invalid (terminal)", () => {
    expect(validateOperationTransition(OperationStatus.APPLIED, OperationStatus.CANCELLED)).toBe(false);
  });

  it("REJECTED → SUBMITTED is valid (resubmit)", () => {
    expect(validateOperationTransition(OperationStatus.REJECTED, OperationStatus.SUBMITTED)).toBe(true);
  });

  it("CONFLICTING → SUBMITTED is valid (resubmit after fix)", () => {
    expect(validateOperationTransition(OperationStatus.CONFLICTING, OperationStatus.SUBMITTED)).toBe(true);
  });

  it("DRAFT → APPLIED is invalid", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.APPLIED)).toBe(false);
  });
});
