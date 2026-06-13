import { describe, it, expect, beforeEach } from "vitest";
import {
  ResourceScope,
  ResourceRefSchema,
  ResourceClaimStatus,
  ResourceClaimMode,
  resourceLocatorsOverlap,
  detectResourceClaimConflicts,
  registerResourceMatcher,
  getResourceMatcher,
  clearResourceMatcherRegistry,
} from "../src/resource.js";
import type { ResourceRef, ResourceClaim, ResourceMatcher } from "../src/resource.js";

// ── Helpers ──────────────────────────────────────────────

function fileRef(locator: string, overrides: Partial<ResourceRef> = {}): ResourceRef {
  return { type: "file", locator, scope: "file", metadata: "", ...overrides };
}

function makeClaim(overrides: Partial<ResourceClaim> = {}): ResourceClaim {
  return {
    id: "claim-1",
    actorId: "agent-1",
    taskId: "task-1",
    sessionId: "",
    resources: [fileRef("src/a.ts")],
    mode: ResourceClaimMode.EXCLUSIVE,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "2026-01-01T00:00:00.000Z",
    releasedAt: "",
    ...overrides,
  };
}

// ── ResourceRef schema ────────────────────────────────────

describe("ResourceRefSchema", () => {
  it("accepts a valid file resource", () => {
    const result = ResourceRefSchema.safeParse({ type: "file", locator: "src/app.ts" });
    expect(result.success).toBe(true);
  });

  it("defaults scope to file", () => {
    const ref = ResourceRefSchema.parse({ type: "file", locator: "src/app.ts" });
    expect(ref.scope).toBe("file");
  });

  it("rejects empty type", () => {
    const result = ResourceRefSchema.safeParse({ type: "", locator: "src/app.ts" });
    expect(result.success).toBe(false);
  });

  it("rejects empty locator", () => {
    const result = ResourceRefSchema.safeParse({ type: "file", locator: "" });
    expect(result.success).toBe(false);
  });

  it("accepts function scope", () => {
    const result = ResourceRefSchema.safeParse({
      type: "file", locator: "src/app.ts", scope: "function", functionName: "main",
    });
    expect(result.success).toBe(true);
  });

  it("accepts line_range scope", () => {
    const result = ResourceRefSchema.safeParse({
      type: "file", locator: "src/app.ts", scope: "line_range",
      lineRange: { start: 10, end: 20 },
    });
    expect(result.success).toBe(true);
  });
});

// ── resourceLocatorsOverlap ──────────────────────────────

describe("resourceLocatorsOverlap", () => {
  it("different types never overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/a.ts", scope: "file", metadata: "" };
    const b: ResourceRef = { type: "function", locator: "main", scope: "file", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("same type and locator overlap", () => {
    const a = fileRef("src/a.ts");
    const b = fileRef("src/a.ts");
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("different locators do not overlap (no matcher registered)", () => {
    const a = fileRef("src/a.ts");
    const b = fileRef("src/b.ts");
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  describe("scope refinement", () => {
    it("file scope covers everything", () => {
      const a = fileRef("src/a.ts", { scope: "file" });
      const b = fileRef("src/a.ts", { scope: "function", functionName: "foo" });
      expect(resourceLocatorsOverlap(a, b)).toBe(true);
    });

    it("two function scopes overlap when same functionName", () => {
      const a = fileRef("src/a.ts", { scope: "function", functionName: "main" });
      const b = fileRef("src/a.ts", { scope: "function", functionName: "main" });
      expect(resourceLocatorsOverlap(a, b)).toBe(true);
    });

    it("two function scopes do NOT overlap when different functionName", () => {
      const a = fileRef("src/a.ts", { scope: "function", functionName: "foo" });
      const b = fileRef("src/a.ts", { scope: "function", functionName: "bar" });
      expect(resourceLocatorsOverlap(a, b)).toBe(false);
    });

    it("two line_range scopes overlap when ranges intersect", () => {
      const a = fileRef("src/a.ts", { scope: "line_range", lineRange: { start: 10, end: 20 } });
      const b = fileRef("src/a.ts", { scope: "line_range", lineRange: { start: 15, end: 25 } });
      expect(resourceLocatorsOverlap(a, b)).toBe(true);
    });

    it("two line_range scopes do NOT overlap when no intersection", () => {
      const a = fileRef("src/a.ts", { scope: "line_range", lineRange: { start: 10, end: 15 } });
      const b = fileRef("src/a.ts", { scope: "line_range", lineRange: { start: 20, end: 25 } });
      expect(resourceLocatorsOverlap(a, b)).toBe(false);
    });

    it("mixed function/line_range conservative overlap", () => {
      const a = fileRef("src/a.ts", { scope: "function", functionName: "foo" });
      const b = fileRef("src/a.ts", { scope: "line_range", lineRange: { start: 10, end: 20 } });
      expect(resourceLocatorsOverlap(a, b)).toBe(true);
    });

    it("missing lineRange defaults to conservative overlap", () => {
      const a = fileRef("src/a.ts", { scope: "line_range" });
      const b = fileRef("src/a.ts", { scope: "line_range", lineRange: { start: 10, end: 20 } });
      expect(resourceLocatorsOverlap(a, b)).toBe(true);
    });
  });

  describe("ResourceMatcher delegation", () => {
    beforeEach(() => {
      clearResourceMatcherRegistry();
    });

    it("uses registered matcher for overlap check", () => {
      const matcher: ResourceMatcher = {
        type: "custom_resource",
        locatorsOverlap: (a, b) => a.startsWith("ns:") && b.startsWith("ns:") && a === b,
      };
      registerResourceMatcher(matcher);
      expect(getResourceMatcher("custom_resource")).toBe(matcher);

      const a: ResourceRef = { type: "custom_resource", locator: "ns:foo", scope: "file", metadata: "" };
      const b: ResourceRef = { type: "custom_resource", locator: "ns:foo", scope: "file", metadata: "" };
      const c: ResourceRef = { type: "custom_resource", locator: "ns:bar", scope: "file", metadata: "" };

      expect(resourceLocatorsOverlap(a, b)).toBe(true);
      expect(resourceLocatorsOverlap(a, c)).toBe(false);
    });

    it("clearResourceMatcherRegistry removes all matchers", () => {
      registerResourceMatcher({ type: "t", locatorsOverlap: () => true });
      expect(getResourceMatcher("t")).toBeDefined();
      clearResourceMatcherRegistry();
      expect(getResourceMatcher("t")).toBeUndefined();
    });
  });
});

// ── detectResourceClaimConflicts ─────────────────────────

describe("detectResourceClaimConflicts", () => {
  it("returns empty for single claim", () => {
    const conflicts = detectResourceClaimConflicts([makeClaim()]);
    expect(conflicts).toEqual([]);
  });

  it("detects hard conflict between two exclusive claims", () => {
    const a = makeClaim({ id: "a", actorId: "agent-1", resources: [fileRef("src/x.ts")] });
    const b = makeClaim({ id: "b", actorId: "agent-2", resources: [fileRef("src/x.ts")] });
    const conflicts = detectResourceClaimConflicts([a, b]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.isHardConflict).toBe(true);
    expect(conflicts[0]!.claimA.id).toBe("a");
    expect(conflicts[0]!.claimB.id).toBe("b");
  });

  it("detects soft conflict between shared claims", () => {
    const a = makeClaim({ id: "a", actorId: "agent-1", mode: ResourceClaimMode.SHARED, resources: [fileRef("src/x.ts")] });
    const b = makeClaim({ id: "b", actorId: "agent-2", mode: ResourceClaimMode.SHARED, resources: [fileRef("src/x.ts")] });
    const conflicts = detectResourceClaimConflicts([a, b]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.isHardConflict).toBe(false);
  });

  it("ignores same actor/task claims", () => {
    const a = makeClaim({ id: "a", actorId: "agent-1", taskId: "task-1", resources: [fileRef("src/x.ts")] });
    const b = makeClaim({ id: "b", actorId: "agent-1", taskId: "task-1", resources: [fileRef("src/x.ts")] });
    const conflicts = detectResourceClaimConflicts([a, b]);
    expect(conflicts).toEqual([]);
  });

  it("ignores non-active claims", () => {
    const a = makeClaim({ id: "a", actorId: "agent-1", resources: [fileRef("src/x.ts")] });
    const b = makeClaim({
      id: "b", actorId: "agent-2", resources: [fileRef("src/x.ts")],
      status: ResourceClaimStatus.RELEASED,
    });
    const conflicts = detectResourceClaimConflicts([a, b]);
    expect(conflicts).toEqual([]);
  });

  it("detects no conflict for non-overlapping resources", () => {
    const a = makeClaim({ id: "a", actorId: "agent-1", resources: [fileRef("src/a.ts")] });
    const b = makeClaim({ id: "b", actorId: "agent-2", resources: [fileRef("src/b.ts")] });
    const conflicts = detectResourceClaimConflicts([a, b]);
    expect(conflicts).toEqual([]);
  });

  it("detects soft conflict between exclusive+shared", () => {
    const a = makeClaim({ id: "a", actorId: "agent-1", mode: ResourceClaimMode.EXCLUSIVE, resources: [fileRef("src/x.ts")] });
    const b = makeClaim({ id: "b", actorId: "agent-2", mode: ResourceClaimMode.SHARED, resources: [fileRef("src/x.ts")] });
    const conflicts = detectResourceClaimConflicts([a, b]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.isHardConflict).toBe(true);
  });
});
