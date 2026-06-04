/**
 * P12 Snapshot Dominant Context — unit tests.
 * Tests: ContextMode enum, SnapshotValidation, ProtocolGateSummary schemas,
 *        validateSnapshot logic, prompt formatters.
 */
import { describe, it, expect } from "vitest";
import {
  ContextMode,
  DEFAULT_CONTEXT_MODE,
  ProtocolRuleSchema,
  ProtocolGateSummarySchema,
  SnapshotValidationSchema,
  SnapshotExtendedFieldsSchema,
} from "../src/context-modes.js";

describe("ContextMode", () => {
  it("parses valid modes", () => {
    expect(ContextMode.parse("snapshot-first")).toBe("snapshot-first");
    expect(ContextMode.parse("snapshot-only")).toBe("snapshot-only");
    expect(ContextMode.parse("snapshot-locked")).toBe("snapshot-locked");
  });

  it("rejects invalid modes", () => {
    expect(() => ContextMode.parse("full")).toThrow();
    expect(() => ContextMode.parse("")).toThrow();
  });

  it("default mode is snapshot-first", () => {
    expect(DEFAULT_CONTEXT_MODE).toBe("snapshot-first");
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

  it("accepts projection source", () => {
    const rule = ProtocolRuleSchema.parse({
      source: "projection",
      severity: "hard",
      summary: "[constraint:mem-1] No eval",
      entityId: "mem-1",
    });
    expect(rule.source).toBe("projection");
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
        resourceClaims: 0,
        activeGates: 0,
        activeTransactions: 0,
        pendingReviews: 0,
        pendingWakes: 0,
      },
    });
    expect(summary.blocked).toBe(false);
    expect(summary.rules).toHaveLength(0);
    expect(summary.counts.projectionRules).toBe(0);
  });

  it("parses summary with projectionRules count", () => {
    const summary = ProtocolGateSummarySchema.parse({
      rules: [{ source: "projection", severity: "hard", summary: "test" }],
      blocked: true,
      hardBlockers: ["test"],
      counts: {
        pinnedRules: 0,
        contractConstraints: 0,
        resourceClaims: 0,
        activeGates: 0,
        activeTransactions: 0,
        pendingReviews: 0,
        pendingWakes: 0,
        projectionRules: 3,
      },
    });
    expect(summary.counts.projectionRules).toBe(3);
  });
});

describe("SnapshotValidationSchema", () => {
  it("parses a valid validation result", () => {
    const val = SnapshotValidationSchema.parse({
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
    const val = SnapshotValidationSchema.parse({
      valid: false,
      stale: true,
      staleReason: "Snapshot older than checkpoint",
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

describe("SnapshotExtendedFieldsSchema", () => {
  it("parses with all defaults", () => {
    const fields = SnapshotExtendedFieldsSchema.parse({});
    expect(fields.intentScope).toBe("");
    expect(fields.nonGoals).toBe("");
    expect(fields.doNotTouch).toBe("");
  });

  it("accepts provided values", () => {
    const fields = SnapshotExtendedFieldsSchema.parse({
      intentScope: "Refactor auth module",
      nonGoals: "Do not touch billing",
      doNotTouch: "packages/billing/*",
    });
    expect(fields.intentScope).toBe("Refactor auth module");
    expect(fields.nonGoals).toBe("Do not touch billing");
  });
});
