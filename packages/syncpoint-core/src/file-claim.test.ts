/**
 * Unit tests for FileClaim — path overlap detection and conflict analysis.
 */

import { describe, it, expect } from "vitest";
import {
  pathsOverlap,
  detectConflicts,
  parseClaimPaths,
  FileClaimStatus,
  FileClaimMode,
} from "./file-claim.js";
import type { FileClaim } from "./file-claim.js";

// ── pathsOverlap ──────────────────────────────────────

describe("pathsOverlap", () => {
  it("exact match", () => {
    expect(pathsOverlap("src/auth.ts", "src/auth.ts")).toBe(true);
  });

  it("no match — different files", () => {
    expect(pathsOverlap("src/auth.ts", "src/api.ts")).toBe(false);
  });

  it("prefix directory overlap", () => {
    expect(pathsOverlap("src", "src/auth.ts")).toBe(true);
    expect(pathsOverlap("src/auth.ts", "src")).toBe(true);
  });

  it("trailing slash normalized", () => {
    expect(pathsOverlap("src/", "src/auth.ts")).toBe(true);
  });

  it("glob star overlap", () => {
    expect(pathsOverlap("src/*", "src/auth.ts")).toBe(true);
    expect(pathsOverlap("src/auth.ts", "src/*")).toBe(true);
  });

  it("double-star glob overlap", () => {
    expect(pathsOverlap("src/**", "src/utils/helper.ts")).toBe(true);
  });

  it("non-overlapping globs", () => {
    expect(pathsOverlap("src/*", "lib/auth.ts")).toBe(false);
  });

  it("sibling directories do not overlap", () => {
    expect(pathsOverlap("src/auth", "src/api")).toBe(false);
  });
});

// ── parseClaimPaths ─────────────────────────────────

describe("parseClaimPaths", () => {
  it("splits comma-separated paths", () => {
    expect(parseClaimPaths("src/auth.ts, src/api/*")).toEqual([
      "src/auth.ts",
      "src/api/*",
    ]);
  });

  it("trims whitespace", () => {
    expect(parseClaimPaths("  a.ts , b.ts  ")).toEqual(["a.ts", "b.ts"]);
  });

  it("filters empty strings", () => {
    expect(parseClaimPaths("a.ts,,b.ts")).toEqual(["a.ts", "b.ts"]);
  });
});

// ── detectConflicts ─────────────────────────────────

function makeClaim(overrides: Partial<FileClaim> & { id: string; agentId: string; taskId: string; paths: string }): FileClaim {
  return {
    sessionId: "s1",
    mode: FileClaimMode.EXCLUSIVE,
    status: FileClaimStatus.ACTIVE,
    createdAt: "2024-01-01",
    releasedAt: "",
    ...overrides,
  };
}

describe("detectConflicts", () => {
  it("no conflict when agents work on different files", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts" }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/api.ts" }),
    ];
    expect(detectConflicts(claims)).toHaveLength(0);
  });

  it("detects conflict on exact same file", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts" }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/auth.ts" }),
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isHardConflict).toBe(true);
  });

  it("detects conflict on glob overlap", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/*" }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/auth.ts" }),
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts).toHaveLength(1);
  });

  it("shared+shared is soft conflict", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts", mode: FileClaimMode.SHARED }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/auth.ts", mode: FileClaimMode.SHARED }),
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isHardConflict).toBe(false);
  });

  it("exclusive+shared is hard conflict", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts", mode: FileClaimMode.EXCLUSIVE }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/auth.ts", mode: FileClaimMode.SHARED }),
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isHardConflict).toBe(true);
  });

  it("ignores released claims", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts" }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/auth.ts", status: FileClaimStatus.RELEASED }),
    ];
    expect(detectConflicts(claims)).toHaveLength(0);
  });

  it("same agent same task is not a conflict", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts" }),
      makeClaim({ id: "c2", agentId: "a1", taskId: "t1", paths: "src/*" }),
    ];
    expect(detectConflicts(claims)).toHaveLength(0);
  });

  it("detects multiple overlapping paths in one claim", () => {
    const claims = [
      makeClaim({ id: "c1", agentId: "a1", taskId: "t1", paths: "src/auth.ts, src/api.ts" }),
      makeClaim({ id: "c2", agentId: "a2", taskId: "t2", paths: "src/auth.ts, lib/utils.ts" }),
    ];
    const conflicts = detectConflicts(claims);
    // Only src/auth.ts overlaps
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].overlappingPath).toContain("src/auth.ts");
  });
});
