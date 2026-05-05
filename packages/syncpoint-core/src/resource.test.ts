/**
 * Unit tests for Resource — generic resource claim and conflict detection.
 */

import { describe, it, expect } from "vitest";
import {
  ResourceClaimStatus,
  ResourceClaimMode,
  resourceLocatorsOverlap,
  detectResourceClaimConflicts,
  filePathsToResourceRefs,
  resourceRefsToFilePaths,
} from "./resource.js";
import type { ResourceRef, ResourceClaim } from "./resource.js";

// ── resourceLocatorsOverlap ────────────────────────

describe("resourceLocatorsOverlap", () => {
  it("file type: exact match", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("file type: glob overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/*", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("file type: no overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "file", locator: "lib/utils.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("different types never overlap", () => {
    const a: ResourceRef = { type: "file", locator: "src/auth.ts", metadata: "" };
    const b: ResourceRef = { type: "image", locator: "src/auth.ts", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });

  it("non-file type: exact match", () => {
    const a: ResourceRef = { type: "image", locator: "assets/logo.png", metadata: "" };
    const b: ResourceRef = { type: "image", locator: "assets/logo.png", metadata: "" };
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("non-file type: no overlap (different locators)", () => {
    const a: ResourceRef = { type: "image", locator: "assets/logo.png", metadata: "" };
    const b: ResourceRef = { type: "image", locator: "assets/icon.png", metadata: "" };
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

// ── filePathsToResourceRefs / resourceRefsToFilePaths ─

describe("filePathsToResourceRefs", () => {
  it("converts comma-separated paths to ResourceRef[]", () => {
    const refs = filePathsToResourceRefs("src/auth.ts, src/api.ts");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ type: "file", locator: "src/auth.ts", metadata: "" });
    expect(refs[1]).toEqual({ type: "file", locator: "src/api.ts", metadata: "" });
  });

  it("filters empty segments", () => {
    const refs = filePathsToResourceRefs("a.ts,,b.ts");
    expect(refs).toHaveLength(2);
  });
});

describe("resourceRefsToFilePaths", () => {
  it("converts file refs back to comma-separated paths", () => {
    const refs: ResourceRef[] = [
      { type: "file", locator: "src/auth.ts", metadata: "" },
      { type: "image", locator: "logo.png", metadata: "" },
      { type: "file", locator: "src/api.ts", metadata: "" },
    ];
    expect(resourceRefsToFilePaths(refs)).toBe("src/auth.ts, src/api.ts");
  });
});
