/**
 * Pure unit tests for Project Memory fingerprint and dedup helpers.
 */
import { describe, it, expect } from "vitest";
import {
  computeMemoryFingerprint,
  isMemoryDuplicate,
  defaultKindFromCategory,
  validProjectionTargets,
  isValidProjection,
  MemoryKind,
  ProjectionTarget,
} from "./project-memory.ts";

describe("computeMemoryFingerprint", () => {
  it("produces deterministic hash for same input", () => {
    const fp1 = computeMemoryFingerprint("decision", "Use SQLite", "Local storage backend");
    const fp2 = computeMemoryFingerprint("decision", "Use SQLite", "Local storage backend");
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(32);
  });

  it("normalizes whitespace and case", () => {
    const fp1 = computeMemoryFingerprint("decision", "Use SQLite", "Local  storage  backend");
    const fp2 = computeMemoryFingerprint("decision", "use sqlite", "local storage backend");
    expect(fp1).toBe(fp2);
  });

  it("different content yields different fingerprint", () => {
    const fp1 = computeMemoryFingerprint("decision", "Use SQLite", "Local storage");
    const fp2 = computeMemoryFingerprint("decision", "Use SQLite", "Cloud storage");
    expect(fp1).not.toBe(fp2);
  });

  it("different category yields different fingerprint", () => {
    const fp1 = computeMemoryFingerprint("decision", "Title", "Content");
    const fp2 = computeMemoryFingerprint("overview", "Title", "Content");
    expect(fp1).not.toBe(fp2);
  });
});

describe("isMemoryDuplicate", () => {
  it("returns true for identical memories", () => {
    expect(isMemoryDuplicate(
      { category: "decision", title: "A", content: "B" },
      { category: "decision", title: "A", content: "B" },
    )).toBe(true);
  });

  it("returns true for whitespace-normalized duplicates", () => {
    expect(isMemoryDuplicate(
      { category: "decision", title: "  Use SQLite  ", content: "Local   backend" },
      { category: "decision", title: "use sqlite", content: "local backend" },
    )).toBe(true);
  });

  it("returns false for different content", () => {
    expect(isMemoryDuplicate(
      { category: "decision", title: "A", content: "B" },
      { category: "decision", title: "A", content: "C" },
    )).toBe(false);
  });
});

describe("defaultKindFromCategory", () => {
  it("risk -> RISK", () => {
    expect(defaultKindFromCategory("risk")).toBe(MemoryKind.RISK);
  });
  it("convention -> SOFT_CONVENTION", () => {
    expect(defaultKindFromCategory("convention")).toBe(MemoryKind.SOFT_CONVENTION);
  });
  it("gotcha -> DO_NOT_TOUCH", () => {
    expect(defaultKindFromCategory("gotcha")).toBe(MemoryKind.DO_NOT_TOUCH);
  });
  it("overview -> FACT (default)", () => {
    expect(defaultKindFromCategory("overview")).toBe(MemoryKind.FACT);
  });
  it("architecture -> FACT (default)", () => {
    expect(defaultKindFromCategory("architecture")).toBe(MemoryKind.FACT);
  });
});

describe("validProjectionTargets", () => {
  it("hard_constraint excludes capsule", () => {
    const targets = validProjectionTargets(MemoryKind.HARD_CONSTRAINT);
    expect(targets).not.toContain(ProjectionTarget.CAPSULE);
    expect(targets).toContain(ProjectionTarget.PROTOCOL_GATE);
    expect(targets).toContain(ProjectionTarget.CONSTRAINT_RUNTIME);
  });
  it("protocol_rule excludes capsule", () => {
    const targets = validProjectionTargets(MemoryKind.PROTOCOL_RULE);
    expect(targets).not.toContain(ProjectionTarget.CAPSULE);
  });
  it("fact allows all targets", () => {
    const targets = validProjectionTargets(MemoryKind.FACT);
    expect(targets).toContain(ProjectionTarget.CAPSULE);
    expect(targets).toContain(ProjectionTarget.PROTOCOL_GATE);
    expect(targets).toContain(ProjectionTarget.CONSTRAINT_RUNTIME);
  });
  it("do_not_touch allows all targets", () => {
    const targets = validProjectionTargets(MemoryKind.DO_NOT_TOUCH);
    expect(targets).toContain(ProjectionTarget.CAPSULE);
  });
});

describe("isValidProjection", () => {
  it("hard_constraint + capsule = false", () => {
    expect(isValidProjection(MemoryKind.HARD_CONSTRAINT, ProjectionTarget.CAPSULE)).toBe(false);
  });
  it("hard_constraint + protocol_gate = true", () => {
    expect(isValidProjection(MemoryKind.HARD_CONSTRAINT, ProjectionTarget.PROTOCOL_GATE)).toBe(true);
  });
  it("protocol_rule + capsule = false", () => {
    expect(isValidProjection(MemoryKind.PROTOCOL_RULE, ProjectionTarget.CAPSULE)).toBe(false);
  });
  it("fact + capsule = true", () => {
    expect(isValidProjection(MemoryKind.FACT, ProjectionTarget.CAPSULE)).toBe(true);
  });
  it("soft_convention + protocol_gate = true", () => {
    expect(isValidProjection(MemoryKind.SOFT_CONVENTION, ProjectionTarget.PROTOCOL_GATE)).toBe(true);
  });
});
