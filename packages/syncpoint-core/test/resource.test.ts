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
} from "../src/resource.js";
import type { ResourceRef, ResourceClaim } from "../src/resource.js";

// ── resourceLocatorsOverlap (matcher dispatch) ─────

describe("resourceLocatorsOverlap", () => {
  beforeEach(() => clearResourceMatcherRegistry());

  it("no matcher: exact locator match → overlap", () => {
    const a: ResourceRef = { type: "test", locator: "src/auth.js", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "test", locator: "src/auth.js", metadata: "", scope: "file" as const };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("no matcher: different locators → no overlap", () => {
    const a: ResourceRef = { type: "test", locator: "src/auth.js", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "test", locator: "src/api.js", metadata: "", scope: "file" as const };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("different types never overlap", () => {
    const a: ResourceRef = { type: "typeA", locator: "same", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "typeB", locator: "same", metadata: "", scope: "file" as const };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("file-type locators are normalized before comparison", () => {
    // These are semantically the same file but with different representations
    const a: ResourceRef = { type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "file", locator: "./src/auth.js", metadata: "", scope: "file" as const };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("file-type locators with different case on case-insensitive platform overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/Auth.js", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const };
    // On Windows (case-insensitive), these should overlap
    // On Linux (case-sensitive), they won't unless SYNCPOINT_CASE_SENSITIVE is set
    const result = resourceLocatorsOverlap(a, b);
    if (process.platform === "win32") {
      expect(result).toBe(true);
    }
    // On case-sensitive platforms, different case = different file
  });

  it("registered matcher is used for overlap", () => {
    registerResourceMatcher({
      type: "custom",
      locatorsOverlap: (a, b) => a.startsWith(b) || b.startsWith(a),
    });
    const a: ResourceRef = { type: "custom", locator: "src/", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "custom", locator: "src/auth.js", metadata: "", scope: "file" as const };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("matcher not called for unregistered type (falls back to exact)", () => {
    registerResourceMatcher({
      type: "custom",
      locatorsOverlap: () => true,
    });
    const a: ResourceRef = { type: "other", locator: "a", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "other", locator: "b", metadata: "", scope: "file" as const };
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
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/api.js", metadata: "", scope: "file" as const }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("detects file resource conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.isHardConflict).toBe(true);
    expect(conflicts[0]!.resourceType).toBe("file");
  });

  it("detects image resource conflict (exact locator match)", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "image", locator: "assets/logo.png", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "image", locator: "assets/logo.png", metadata: "", scope: "file" as const }],
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.resourceType).toBe("image");
  });

  it("no cross-type conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "logo.png", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "image", locator: "logo.png", metadata: "", scope: "file" as const }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("shared+shared is soft conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
        mode: ResourceClaimMode.SHARED,
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
        mode: ResourceClaimMode.SHARED,
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.isHardConflict).toBe(false);
  });

  it("ignores released claims", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
        status: ResourceClaimStatus.RELEASED,
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("same actor same task is not a conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/*", metadata: "", scope: "file" as const }],
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
    const a: ResourceRef = { type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("function scope: same function overlaps", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("function scope: different functions do NOT overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "logout", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("line_range scope: overlapping ranges overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 10, end: 30 }, metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 20, end: 40 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("line_range scope: non-overlapping ranges do NOT overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 10, end: 20 }, metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 30, end: 50 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("line_range scope: touching ranges (end === start) overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 10, end: 20 }, metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 20, end: 30 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("mixed function + line_range → conservative overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 50, end: 80 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("different locators never overlap regardless of scope", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/api.js", scope: "function", functionName: "login", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("file scope vs line_range on same locator overlaps", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const };
    const b: ResourceRef = { type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 1, end: 10 }, metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });
});

// ── Scope-aware conflict detection ──────────────────

describe("detectResourceClaimConflicts — scope refinement", () => {
  beforeEach(() => clearResourceMatcherRegistry());

  registerResourceMatcher({
    type: "file",
    locatorsOverlap: (a, b) => {
      const na = a.replace(/\/+$/, "");
      const nb = b.replace(/\/+$/, "");
      return na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/") || na.includes("*") || nb.includes("*");
    },
  });

  it("same file different functions → no conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", scope: "function", functionName: "logout", metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("same file same function → conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" }],
      }),
    ];
    const conflicts = detectResourceClaimConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.isHardConflict).toBe(true);
  });

  it("line_range non-overlapping → no conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 1, end: 20 }, metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 30, end: 50 }, metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(0);
  });

  it("line_range overlapping → conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 10, end: 30 }, metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 20, end: 40 }, metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(1);
  });

  it("mixed scope (function vs line_range) → conservative conflict", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", scope: "line_range", lineRange: { start: 50, end: 80 }, metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(1);
  });

  it("file-scope claim conflicts with any sub-scope on same locator", () => {
    const claims = [
      makeResourceClaim({
        id: "c1", actorId: "a1", taskId: "t1",
        resources: [{ type: "file", locator: "src/auth.js", metadata: "", scope: "file" as const }],
      }),
      makeResourceClaim({
        id: "c2", actorId: "a2", taskId: "t2",
        resources: [{ type: "file", locator: "src/auth.js", scope: "function", functionName: "login", metadata: "" }],
      }),
    ];
    expect(detectResourceClaimConflicts(claims)).toHaveLength(1);
  });
});
