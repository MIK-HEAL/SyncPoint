/**
 * Unit tests for Resource — generic resource claim and conflict detection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ResourceClaimStatus,
  ResourceClaimMode,
  resourceLocatorsOverlap,
  detectResourceClaimConflicts,
  registerResourceMatcher,
  clearResourceMatcherRegistry,
} from "./resource.js";
import type { ResourceRef, ResourceClaim } from "./resource.js";

// ── resourceLocatorsOverlap (matcher dispatch) ─────

describe("resourceLocatorsOverlap", () => {
  beforeEach(() => clearResourceMatcherRegistry());

  it("no matcher: exact locator match → overlap", () => {
    const a: ResourceRef = { type: "test", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "test", locator: "src/auth.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("no matcher: different locators → no overlap", () => {
    const a: ResourceRef = { type: "test", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "test", locator: "src/api.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("different types never overlap", () => {
    const a: ResourceRef = { type: "typeA", locator: "same", metadata: "" };
    const b: ResourceRef = { type: "typeB", locator: "same", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("registered matcher is used for overlap", () => {
    registerResourceMatcher({
      type: "custom",
      locatorsOverlap: (a, b) => a.startsWith(b) || b.startsWith(a),
    });
    const a: ResourceRef = { type: "custom", locator: "src/", metadata: "" };
    const b: ResourceRef = { type: "custom", locator: "src/auth.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("matcher not called for unregistered type (falls back to exact)", () => {
    registerResourceMatcher({
      type: "custom",
      locatorsOverlap: () => true,
    });
    const a: ResourceRef = { type: "other", locator: "a", metadata: "" };
    const b: ResourceRef = { type: "other", locator: "b", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });
});

// ── detectResourceClaimConflicts ───────────────────

function makeResourceClaim(overrides: Partial<ResourceClaim> & {
  id: string;
  actorId: string;
  taskId: string;
  resources: ResourceRef[];
}): ResourceClaim {
  return {
    sessionId: "s1",
    mode: ResourceClaimMode.EXCLUSIVE,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "2024-01-01",
    releasedAt: "",
    ...overrides,
  };
}

describe("detectResourceClaimConflicts", () => {
  it("no conflict for different resources", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/api.ts", metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("detects file resource conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isHardConflict).toBe(true);
    expect(conflicts[0].resourceType).toBe("file");
  });

  it("detects image resource conflict (exact locator match)", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "image", locator: "assets/logo.png", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "image", locator: "assets/logo.png", metadata: "" }],
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resourceType).toBe("image");
  });

  it("no cross-type conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "logo.png", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "image", locator: "logo.png", metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("shared+shared is soft conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
        mode: ResourceClaimMode.SHARED,
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
        mode: ResourceClaimMode.SHARED,
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isHardConflict).toBe(false);
  });

  it("ignores released claims", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
        status: ResourceClaimStatus.RELEASED,
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("same actor same task is not a conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/*", metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });
});

// ── Scope-aware overlap ─────────────────────────────

describe("resourceLocatorsOverlap — scope refinement", () => {
  beforeEach(() => clearResourceMatcherRegistry());

  // Register a file matcher so locator-level overlap works
  registerResourceMatcher({
    type: "file",
    locatorsOverlap: (a, b) => {
      const na = a.replace(/\/+$/, "");
      const nb = b.replace(/\/+$/, "");
      if (na === nb) return true;
      if (na.startsWith(nb + "/") || nb.startsWith(na + "/")) return true;
      if (na.includes("*") || nb.includes("*")) return true;
      return false;
    },
  });

  it("file scope (default) overlaps with any sub-file scope on same locator", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "login", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("function scope: same function overlaps", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "login", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("function scope: different functions do NOT overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "logout", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("line_range scope: overlapping ranges overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 10, end: 30 }, metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 20, end: 40 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("line_range scope: non-overlapping ranges do NOT overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 10, end: 20 }, metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 30, end: 50 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("line_range scope: touching ranges (end === start) overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 10, end: 20 }, metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 20, end: 30 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("mixed function + line_range → conservative overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 50, end: 80 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("different locators never overlap regardless of scope", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/api.ts", scope: "function", functionName: "login", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("file scope vs line_range on same locator overlaps", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", scope: "line_range", lineRange: { start: 1, end: 10 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });
});
