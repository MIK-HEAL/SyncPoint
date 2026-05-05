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
