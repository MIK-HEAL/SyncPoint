/**
 * P12 Capsule Dominant Context — unit tests.
 * Tests: ContextMode enum, CapsuleValidation, ProtocolGateSummary schemas,
 *        validateCapsule logic, prompt formatters.
 */
import { describe, it, expect } from "vitest";
import {
  ContextMode,
  DEFAULT_CONTEXT_MODE,
  ProtocolRuleSchema,
  ProtocolGateSummarySchema,
  CapsuleValidationSchema,
  CapsuleExtendedFieldsSchema,
} from "./capsule-context.js";

describe("ContextMode", () => {
  it("parses valid modes", () => {
    expect(ContextMode.parse("capsule-first")).toBe("capsule-first");
    expect(ContextMode.parse("capsule-only")).toBe("capsule-only");
    expect(ContextMode.parse("capsule-locked")).toBe("capsule-locked");
  });

  it("rejects invalid modes", () => {
    expect(() => ContextMode.parse("full")).toThrow();
    expect(() => ContextMode.parse("")).toThrow();
  });

  it("default mode is capsule-first", () => {
    expect(DEFAULT_CONTEXT_MODE).toBe("capsule-first");
  });
});

describe("ProtocolRuleSchema", () => {
  it("parses a valid rule", () => {
    const rule = ProtocolRuleSchema.parse({
      source: "pinned-memory",
      severity: "hard",
      summary: "No direct DB access",
    });
    expect(rule.source).toBe("pinned-memory");
    expect(rule.severity).toBe("hard");
    expect(rule.entityId).toBeUndefined();
  });

  it("includes optional entityId", () => {
    const rule = ProtocolRuleSchema.parse({
      source: "sync-gate",
      severity: "hard",
      summary: "Gate XYZ",
      entityId: "gate-123",
    });
    expect(rule.entityId).toBe("gate-123");
  });

  it("validates source enum", () => {
    expect(() => ProtocolRuleSchema.parse({
      source: "unknown",
      severity: "hard",
      summary: "test",
    })).toThrow();
  });
});

describe("ProtocolGateSummarySchema", () => {
  it("parses a complete summary", () => {
    const summary = ProtocolGateSummarySchema.parse({
      rules: [],
      blocked: false,
      hardBlockers: [],
      counts: {
        pinnedRules: 0,
        contractConstraints: 0,
        fileClaims: 0,
        activeGates: 0,
        activeTransactions: 0,
        pendingReviews: 0,
        pendingWakes: 0,
      },
    });
    expect(summary.blocked).toBe(false);
    expect(summary.rules).toHaveLength(0);
  });
});

describe("CapsuleValidationSchema", () => {
  it("parses a valid validation result", () => {
    const val = CapsuleValidationSchema.parse({
      valid: true,
      stale: false,
      staleReason: null,
      scopeMatch: true,
      hasBlockers: false,
      hasEvidence: true,
      needsSync: false,
      notes: [],
    });
    expect(val.valid).toBe(true);
  });

  it("parses a failing validation", () => {
    const val = CapsuleValidationSchema.parse({
      valid: false,
      stale: true,
      staleReason: "Capsule older than checkpoint",
      scopeMatch: true,
      hasBlockers: true,
      hasEvidence: true,
      needsSync: true,
      notes: ["Stale", "Has blockers", "Needs sync"],
    });
    expect(val.valid).toBe(false);
    expect(val.notes).toHaveLength(3);
  });
});

describe("CapsuleExtendedFieldsSchema", () => {
  it("parses with all defaults", () => {
    const fields = CapsuleExtendedFieldsSchema.parse({});
    expect(fields.intentScope).toBe("");
    expect(fields.nonGoals).toBe("");
    expect(fields.doNotTouch).toBe("");
  });

  it("accepts provided values", () => {
    const fields = CapsuleExtendedFieldsSchema.parse({
      intentScope: "Refactor auth module",
      nonGoals: "Do not touch billing",
      doNotTouch: "packages/billing/*",
    });
    expect(fields.intentScope).toBe("Refactor auth module");
    expect(fields.nonGoals).toBe("Do not touch billing");
  });
});
